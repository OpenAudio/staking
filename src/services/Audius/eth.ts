/**
 * Ethereum service for the staking dashboard.
 *
 * Builds on @audius/sdk's `createSdkWithServices`, which provides viem
 * `PublicClient` / `WalletClient` already wired with Audius's mainnet eth
 * config (rpc endpoint, contract addresses).
 *
 * Why we don't use `sdk.services.ethereum.<contract>.read.*` directly:
 * the staking app has `strict: false` in tsconfig, and viem's `getContract`
 * return type relies on the `KeyedClient` discriminator narrowing only
 * under strict mode. The contracts work at runtime but lose their typed
 * `.read` / `.simulate` / `.write` properties at compile time.
 *
 * Instead we expose the underlying viem clients + per-contract `{ address,
 * abi }` constants and call `publicClient.readContract({ ...token(), ... })`
 * style. viem's action-level functions narrow cleanly with strict off.
 *
 * Lifecycle:
 *   1. On module load we construct a *read-only* sdk instance (no signer).
 *      All reads work immediately — no wallet required.
 *   2. When web3modal connects a wallet, `attachSigner({ walletProvider,
 *      account })` re-creates the sdk with a viem `WalletClient` wrapping
 *      the user's Eip1193 provider. Writes go through the connected account.
 *
 * Convention used by every contract wrapper:
 *
 *   import { read, write, simulate, contracts } from '../eth'
 *
 *   // Read:
 *   const total = await read({
 *     ...contracts.staking(),
 *     functionName: 'totalStaked'
 *   })  // bigint
 *
 *   // Write (sends tx and returns hash):
 *   const hash = await write({
 *     ...contracts.delegateManager(),
 *     functionName: 'delegateStake',
 *     args: [targetSP, amount]
 *   })
 *
 * viem returns native `bigint`; wrappers convert to `BN` at the boundary
 * via `toBN()` so the rest of the dashboard's consumer code is unchanged.
 */

import {
  AudiusToken,
  AudiusWormhole,
  ClaimsManager,
  DelegateManager,
  EthRewardsManager,
  Governance,
  Registry,
  ServiceProviderFactory,
  ServiceTypeManager,
  Staking,
  TrustedNotifierManager
} from '@audius/eth'
// In @audius/sdk@14.1.0 `createSdkWithServices` is an internal helper that
// isn't surfaced as a named export — the runtime symbol exists in the
// bundle but tree-shakes away when imported through `* as audiusSdk`. The
// public entry that actually returns it (along with `services.ethPublicClient`
// / `services.ethWalletClient`) is `sdk({ appName, environment })`, which
// dispatches through `createSdkWithApiName(config)` to the same factory.
//
// We pin sdk to 14.1.0 because sdk@15.x drops the top-level `OAUTH_URL`
// export that the OAuth profile-link flow (useConnectAudiusProfile.ts)
// still imports.
import { sdk } from '@audius/sdk'
import BN from 'bn.js'
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Block as ViemBlock,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type TransactionReceipt as ViemTxReceipt,
  type WalletClient
} from 'viem'
import { mainnet } from 'viem/chains'

import type { Address, TxReceipt } from 'types'

type AudiusEthSdk = ReturnType<typeof sdk>

const env = import.meta.env.VITE_ENVIRONMENT as
  | 'development'
  | 'production'
  | undefined

const baseConfig = {
  appName: 'Open Audio Protocol Staking',
  environment: env
} as const

/**
 * Idempotent eth reads (eth_call, eth_getLogs, eth_getCode, …) get
 * deduplicated and cached for this long after settling. View methods that
 * the dashboard reads here change on user-driven writes, which we
 * explicitly invalidate via invalidateReadCache() inside writeAndWait().
 *
 * Declared before the JSON-RPC-cache wrapper closes over it so the const
 * is initialized by the time the wrapped `request()` fn actually runs
 * (avoids any chance of a TDZ error during sdk init).
 */
const READ_CACHE_TTL_MS = 30_000

/**
 * Build a batched viem `PublicClient` to inject as `services.ethPublicClient`.
 *
 * The sdk's default `ethPublicClient` uses `http()` with no batching, so a
 * page load that fans out hundreds of `eth_call`s (fetchValidators +
 * fetchContentNodes + fetchDiscoveryProviders' `getServiceProviderList`
 * fan-out, plus per-user `formatUser` reads) becomes hundreds of separate
 * POSTs to eth-client.audius.co. The legacy @audius/sdk-legacy did this
 * via multicall, which is how the dashboard on main stays quiet.
 *
 * viem's `http(url, { batch: ... })` collects every `eth_call` fired in the
 * same microtask (or up to `wait` ms) into one JSON-RPC batch request. This
 * collapses the RPC volume by ~50x for the typical fan-out (Promise.all of
 * N parallel reads) without any call-site changes.
 */
function buildBatchedEthPublicClient(): PublicClient {
  const rpcEndpoint = import.meta.env.VITE_ETH_PROVIDER_URL as string | undefined
  // Cast: viem's PublicClient type encodes the `account` field as
  // `undefined`; `createPublicClient`'s return widens that — fine at
  // runtime but tsc balks. Type identity isn't important here since this
  // client is only consumed via the sdk's ServicesContainer.
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcEndpoint, {
      batch: { batchSize: 100, wait: 16 }
    })
  }) as unknown as PublicClient
  return wrapWithJsonRpcCache(client)
}

/**
 * Wrap a PublicClient's `request` method to deduplicate and short-TTL-cache
 * idempotent JSON-RPC reads (eth_call, eth_getCode, eth_getLogs,
 * eth_getBlockByNumber with a concrete block, eth_getTransactionReceipt,
 * eth_chainId). Methods that depend on chain head (eth_blockNumber,
 * eth_getBlockByNumber with "latest"/"pending") are passed through.
 *
 * This sits *below* the higher-level `read()` cache so it also catches:
 *   - getContractEvents → eth_getLogs (event reads we issue ourselves)
 *   - isEoa's getCode → eth_getCode (looped per operator wallet)
 *   - anything inside the @audius/sdk that bypasses our wrappers
 *
 * The two layers complement each other: `read()` deduplicates within a
 * single Promise.all microtask before constructing the JSON-RPC request;
 * this layer dedupes across components / re-renders / paths that don't
 * route through `read()` at all.
 */
function wrapWithJsonRpcCache(client: PublicClient): PublicClient {
  const READ_METHODS = new Set([
    'eth_call',
    'eth_getCode',
    'eth_getLogs',
    'eth_getBlockByHash',
    'eth_getBlockByNumber',
    'eth_getTransactionReceipt',
    'eth_chainId',
    'net_version'
  ])
  const isLatestBlockQuery = (method: string, params: any): boolean => {
    if (method !== 'eth_getBlockByNumber') return false
    const blockTag = Array.isArray(params) ? params[0] : undefined
    return blockTag === 'latest' || blockTag === 'pending' || blockTag === 'safe'
  }

  const cache = new Map<string, { promise: Promise<unknown>; expires: number }>()
  const origRequest = client.request.bind(client)

  ;(client as any).request = async (args: any, opts?: any): Promise<unknown> => {
    if (!READ_METHODS.has(args.method) || isLatestBlockQuery(args.method, args.params)) {
      return origRequest(args, opts)
    }
    const key = `${args.method}:${JSON.stringify(args.params, (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : v
    )}`
    const now = Date.now()
    const existing = cache.get(key)
    if (existing && existing.expires > now) {
      return existing.promise
    }
    const promise = origRequest(args, opts)
    cache.set(key, { promise, expires: Number.POSITIVE_INFINITY })
    promise.then(
      () => {
        cache.set(key, {
          promise,
          expires: Date.now() + READ_CACHE_TTL_MS
        })
      },
      () => {
        cache.delete(key)
      }
    )
    return promise
  }
  return client
}

let _sdk: AudiusEthSdk = sdk({
  ...baseConfig,
  services: { ethPublicClient: buildBatchedEthPublicClient() as any }
})

/** The current @audius/sdk instance (read-only until `attachSigner` runs). */
export function getEthSdk(): AudiusEthSdk {
  return _sdk
}

/** viem PublicClient (used for all reads, block / log / code queries). */
export function getEthPublicClient() {
  return _sdk.services.ethPublicClient
}

/** viem WalletClient (no-op signer until `attachSigner` runs). */
export function getEthWalletClient() {
  return _sdk.services.ethWalletClient
}

/** The user's connected eth account (undefined until a wallet is attached). */
export function getConnectedAccount(): Hex | undefined {
  return _sdk.services.ethWalletClient.account?.address as Hex | undefined
}

/**
 * Wire an Eip1193 wallet provider (web3modal's output) into the sdk's
 * EthereumService. Re-creates the sdk so the wallet client is picked up by
 * every contract instance. Safe to call multiple times.
 */
export function attachSigner({
  walletProvider,
  account
}: {
  walletProvider: EIP1193Provider
  account: Hex
}): AudiusEthSdk {
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: custom(walletProvider)
  })
  _sdk = sdk({
    ...baseConfig,
    services: {
      // Re-inject the batched public client so writes (which still do
      // reads for nonce / gas estimation / waitForTransactionReceipt) stay
      // batched too. viem types come from two node_modules locations (ours
      // and the one nested inside @audius/sdk) — identical at runtime but
      // tsc treats them as nominally distinct, so cast at the boundary.
      ethPublicClient: buildBatchedEthPublicClient() as any,
      ethWalletClient: walletClient as any
    }
  })
  return _sdk
}

/* -------------------- Contract address + abi accessors -------------------- */

/**
 * `{ address, abi }` pairs spread into viem `readContract` /
 * `writeContract` / `simulateContract` calls. Returns a fresh object each
 * call (cheap — abi/address are static references) so we can safely spread.
 */
export const contracts = {
  audiusToken: () =>
    ({ address: AudiusToken.address, abi: AudiusToken.abi } as const),
  audiusWormhole: () =>
    ({ address: AudiusWormhole.address, abi: AudiusWormhole.abi } as const),
  claimsManager: () =>
    ({ address: ClaimsManager.address, abi: ClaimsManager.abi } as const),
  delegateManager: () =>
    ({ address: DelegateManager.address, abi: DelegateManager.abi } as const),
  ethRewardsManager: () =>
    ({
      address: EthRewardsManager.address,
      abi: EthRewardsManager.abi
    } as const),
  governance: () =>
    ({ address: Governance.address, abi: Governance.abi } as const),
  registry: () => ({ address: Registry.address, abi: Registry.abi } as const),
  serviceProviderFactory: () =>
    ({
      address: ServiceProviderFactory.address,
      abi: ServiceProviderFactory.abi
    } as const),
  serviceTypeManager: () =>
    ({
      address: ServiceTypeManager.address,
      abi: ServiceTypeManager.abi
    } as const),
  staking: () => ({ address: Staking.address, abi: Staking.abi } as const),
  trustedNotifierManager: () =>
    ({
      address: TrustedNotifierManager.address,
      abi: TrustedNotifierManager.abi
    } as const)
}

/* -------------------- Read / write / simulate helpers -------------------- */

/**
 * Thin wrapper around `publicClient.readContract` with in-flight
 * deduplication + short-TTL caching.
 *
 * Why: react components like TopOperatorsTable render UserImage + UserName
 * for every operator row, both of which call useUserProfile -> useUser
 * for the same wallet. Each useUser instance can independently dispatch
 * fetchUser/fetchUsers, which fans out reads like
 * \`getPendingUndelegateRequest(wallet)\` for every operator. Without
 * deduplication, the same read fires once per consumer. On top of that,
 * if web3modal's WebSocket-reconnect retry loop bumps React state every
 * second (the workers-preview domain isn't whitelisted in Reown, so
 * connection fails repeatedly), every re-render that triggers a thunk
 * compounds the spam.
 *
 * The legacy @audius/sdk-legacy implicitly absorbed this via its own
 * caching/multicall layer — \`main\` doesn't hammer eth-client.audius.co.
 * We restore the same property with two layers here:
 *
 *   1. **In-flight coalescing** — if a read with the same key is already
 *      pending, return the same Promise instead of issuing a second one.
 *   2. **Short-TTL settled cache** — after a read resolves, hold the
 *      result for READ_CACHE_TTL_MS so a re-render within the window
 *      doesn't reissue. View methods we read here change on user-driven
 *      tx flows that the dashboard already invalidates explicitly, so a
 *      30s TTL is safe.
 *
 * Callers cast the return value at the boundary — see \`toBN()\` for the
 * bigint -> BN conversion that wrappers apply.
 */
type CacheEntry = { promise: Promise<unknown>; expires: number }
const _readCache = new Map<string, CacheEntry>()

function readCacheKey(params: {
  address: Hex
  functionName: string
  args?: readonly unknown[]
}): string {
  // JSON.stringify with a replacer that handles bigint — viem args are
  // frequently bigints (block numbers, amounts) and JSON.stringify throws
  // on them by default.
  return JSON.stringify(params, (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : v
  )
}

export function read(params: {
  address: Hex
  abi: readonly any[]
  functionName: string
  args?: readonly unknown[]
}): Promise<unknown> {
  const key = readCacheKey(params)
  const now = Date.now()
  const existing = _readCache.get(key)
  if (existing && existing.expires > now) {
    return existing.promise
  }
  const promise = getEthPublicClient().readContract(params as any)
  // Cache while in-flight + for READ_CACHE_TTL_MS after settling. On
  // rejection, evict immediately so the next call retries instead of
  // re-throwing the cached error.
  _readCache.set(key, { promise, expires: Number.POSITIVE_INFINITY })
  promise.then(
    () => {
      _readCache.set(key, { promise, expires: Date.now() + READ_CACHE_TTL_MS })
    },
    () => {
      _readCache.delete(key)
    }
  )
  return promise
}

/**
 * Drop all cached reads. Call after a write that we know mutated state
 * (e.g., delegateStake / undelegateStake / claimRewards) so subsequent
 * reads see fresh data instead of the cached pre-write value.
 */
export function invalidateReadCache(): void {
  _readCache.clear()
}

/** Thin wrapper around `walletClient.writeContract`. Auto-fills `account` + `chain`. */
export function write(params: {
  address: Hex
  abi: readonly any[]
  functionName: string
  args?: readonly unknown[]
}): Promise<Hex> {
  const wallet = getEthWalletClient()
  return wallet.writeContract({
    account: wallet.account ?? null,
    chain: mainnet,
    ...params
  } as any) as Promise<Hex>
}

/** Thin wrapper around `publicClient.simulateContract` (validates pre-write). */
export function simulate(params: {
  address: Hex
  abi: readonly any[]
  functionName: string
  args?: readonly unknown[]
  account?: Hex
}) {
  return getEthPublicClient().simulateContract(params as any)
}

/**
 * Send a write tx, wait for the receipt, project it into the legacy `TxReceipt`
 * shape the rest of the dashboard expects (bigints -> numbers, no decoded
 * event dict — `events` is left as `{}` since no consumer reads it).
 */
export async function writeAndWait(params: {
  address: Hex
  abi: readonly any[]
  functionName: string
  args?: readonly unknown[]
}): Promise<TxReceipt> {
  const hash = await write(params)
  const receipt = await getEthPublicClient().waitForTransactionReceipt({ hash })
  // The write almost certainly mutated state we previously read; clear
  // the cache so subsequent reads return current values.
  invalidateReadCache()
  return toLegacyTxReceipt(receipt)
}

/** Project a viem `TransactionReceipt` into the dashboard's legacy `TxReceipt`. */
export function toLegacyTxReceipt(receipt: ViemTxReceipt): TxReceipt {
  return {
    blockHash: receipt.blockHash,
    blockNumber: Number(receipt.blockNumber),
    contractAddress: receipt.contractAddress ?? null,
    cumulativeGasUsed: Number(receipt.cumulativeGasUsed),
    // viem's TransactionReceipt does not include a decoded event dict; the
    // legacy field is only used in console logs / fall-throughs that don't
    // care about its contents.
    events: {},
    from: receipt.from,
    gasUsed: Number(receipt.gasUsed),
    logsBloom: receipt.logsBloom,
    status: receipt.status === 'success',
    to: receipt.to ?? '',
    transactionHash: receipt.transactionHash,
    transactionIndex: receipt.transactionIndex
  }
}

/* -------------------- Type-level helpers -------------------- */

/**
 * Cast an `Address` (plain string in this codebase) to viem's `Hex` template
 * literal type. We don't validate at the boundary — the legacy code didn't
 * either, and addresses originate from on-chain reads or env vars that are
 * already well-formed.
 */
export const asHex = (addr: Address | string): Hex => addr as Hex

/**
 * Convert a viem `bigint` (modern eth return type) to `BN` (the type the rest
 * of the staking dashboard expects). This is the boundary at which wrappers
 * normalize bigint -> BN before returning to consumers.
 */
export const toBN = (value: bigint | number | string): BN =>
  new BN(value.toString())

/** Inverse of `toBN` for write paths that need `bigint` args. */
export const toBig = (value: BN | bigint | number | string): bigint =>
  typeof value === 'bigint' ? value : BigInt(value.toString())

/**
 * Lower bound for `getContractEvents({ fromBlock })` calls. The Audius eth
 * contracts (Staking / DelegateManager / Governance / ServiceProviderFactory /
 * ClaimsManager) were all deployed in roughly the same window of mainnet
 * history; the governance dashboard already pins that block via
 * `VITE_QUERY_PROPOSAL_START_BLOCK`. Reusing it here keeps every event
 * scan bounded — scanning from block 0 makes the RPC sweep ~10M blocks per
 * call, which Audius's eth-client (and most providers) heavily rate-limit
 * or time out on.
 */
export const EVENT_QUERY_START_BLOCK: bigint = BigInt(
  parseInt(import.meta.env.VITE_QUERY_PROPOSAL_START_BLOCK || '0') || 0
)

/**
 * Project a viem `Block` to the legacy web3.js block shape consumers expect:
 * `bigint` fields (timestamp, number, gasUsed, ...) become regular `number`s.
 *
 * Required because consumer code does things like
 * `timestampB - timestampA` inside `Array.sort` comparators — `bigint - bigint`
 * yields a bigint, which the sort runtime can't coerce to a comparison
 * number, throwing `TypeError: Cannot convert a BigInt value to a number`.
 */
export function toLegacyBlock(block: ViemBlock): any {
  if (!block) return block
  const out: any = { ...block }
  for (const key of [
    'baseFeePerGas',
    'blobGasUsed',
    'difficulty',
    'excessBlobGas',
    'gasLimit',
    'gasUsed',
    'number',
    'size',
    'timestamp',
    'totalDifficulty'
  ] as const) {
    const v = (block as any)[key]
    if (typeof v === 'bigint') out[key] = Number(v)
  }
  return out
}
