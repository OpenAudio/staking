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
// `createSdkWithServices` ships in the @audius/sdk@14.1.0 runtime bundle
// (dist/index.cjs.js / dist/index.esm.js) but isn't re-exported from the
// package's top-level `dist/index.d.ts`. We import the runtime symbol from
// the top level via a property-access cast, and pull the type from the
// published subpath declaration. (sdk@15.x re-exports the function at the
// top level but drops `OAUTH_URL`, which the OAuth profile-link flow in
// useConnectAudiusProfile.ts still imports — 14.1.0 is the newest version
// that has both.)
import * as audiusSdk from '@audius/sdk'
import type { createSdkWithServices as CreateSdkWithServicesFn } from '@audius/sdk/dist/sdk/createSdkWithServices'

const createSdkWithServices = (audiusSdk as unknown as {
  createSdkWithServices: typeof CreateSdkWithServicesFn
}).createSdkWithServices
import BN from 'bn.js'
import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type Hex,
  type TransactionReceipt as ViemTxReceipt,
  type WalletClient
} from 'viem'
import { mainnet } from 'viem/chains'

import type { Address, TxReceipt } from 'types'

type AudiusEthSdk = ReturnType<typeof CreateSdkWithServicesFn>

const env = import.meta.env.VITE_ENVIRONMENT as
  | 'development'
  | 'production'
  | undefined

const baseConfig = {
  appName: 'Open Audio Protocol Staking',
  environment: env
} as const

let _sdk: AudiusEthSdk = createSdkWithServices(baseConfig)

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
  _sdk = createSdkWithServices({
    ...baseConfig,
    services: {
      // viem types come from two node_modules locations (ours and the one
      // nested inside @audius/sdk). They're identical at runtime but tsc
      // treats them as nominally distinct, so we cast at the boundary.
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
 * Thin wrapper around `publicClient.readContract`. Forwards every viem
 * parameter; just saves the caller from threading the client through.
 *
 * We accept loose `any`-typed params to dodge viem's strict-mode-only type
 * narrowing (the staking app has `strict: false`). Callers cast the
 * return value at the boundary — see `toBN()` for the bigint -> BN
 * conversion that wrappers apply.
 */
export function read(params: {
  address: Hex
  abi: readonly any[]
  functionName: string
  args?: readonly unknown[]
}): Promise<unknown> {
  return getEthPublicClient().readContract(params as any)
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
