/**
 * Two-step setup flow for `AudiusClient`:
 *
 *   1. **Read-only mode** — runs immediately on module load. The
 *      `createSdkWithServices()` call inside `eth.ts` builds a viem
 *      PublicClient against Audius's mainnet ethereum RPC, so all read
 *      paths (Staking, Delegate, Governance, SP, ClaimsManager …) work
 *      without a wallet. If the user doesn't connect within ~3.5s we
 *      flip `isViewOnly` and finish setup; otherwise we wait.
 *
 *   2. **Connected mode** — when the AppBar resolves the
 *      `accountConnectedPromise` with an Eip1193 provider from web3modal,
 *      we validate the chain id, call `attachSigner()` to rebuild the sdk
 *      with a viem WalletClient bound to the user's account, and finish
 *      setup with `hasValidAccount = true`.
 *
 * No more AudiusLibs / web3.js — every eth interaction now goes through
 * the viem clients exposed by `eth.ts`. The Solana / Wormhole / claim
 * distribution config that the legacy `AudiusLibs.configEthWeb3` and
 * `configSolanaWeb3` consumed has been audited and dropped (no consumer
 * code in this app touched any of those subsystems).
 */

import { CHAIN_ID } from 'utils/eth'

import { AudiusClient } from './AudiusClient'
import { attachSigner } from './eth'

/**
 * A minimal Eip1193 wallet provider interface. We deliberately avoid
 * importing viem's `Eip1193Provider` or ethers' `Eip1193Provider`
 * directly here: web3modal hands us the ethers flavor and our internal
 * code consumes a structurally compatible subset (`request(...)`),
 * so the loosest shape that works for both is the right type.
 */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

export const IS_PRODUCTION = import.meta.env.VITE_ENVIRONMENT === 'production'

export const getWalletChainId = async (
  walletProvider: Eip1193Provider
): Promise<string> => {
  const chainId = (await walletProvider.request({
    method: 'eth_chainId',
    params: []
  } as any)) as string
  return parseInt(chainId, 16).toString()
}

/**
 * Eth providers sometimes return a null chainId on first request, so retry
 * once after a short delay before giving up.
 */
const getWalletIsOnEthMainnet = async (walletProvider: Eip1193Provider) => {
  let chainId = await getWalletChainId(walletProvider)
  if (chainId === CHAIN_ID) return true

  chainId = await new Promise((resolve) => {
    console.debug('Wallet network not matching, trying again')
    setTimeout(async () => {
      chainId = await getWalletChainId(walletProvider)
      resolve(chainId)
    }, 2000)
  })

  return chainId === CHAIN_ID
}

const getWalletAccount = async (
  walletProvider: Eip1193Provider
): Promise<`0x${string}` | null> => {
  const accounts = (await walletProvider.request({
    method: 'eth_accounts',
    params: []
  } as any)) as `0x${string}`[] | undefined
  return accounts?.[0] ?? null
}

export let resolveAccountConnected:
  | null
  | ((provider: Eip1193Provider) => void) = null
const accountConnectedPromise = new Promise<Eip1193Provider>((resolve) => {
  resolveAccountConnected = resolve
})

export async function setup(this: AudiusClient): Promise<void> {
  // Read-only mode by default. If the user doesn't connect within 3.5s,
  // mark setup as complete in view-only mode so the dashboard renders.
  const quickConnectedWalletProvider = await Promise.race([
    accountConnectedPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500))
  ])

  if (quickConnectedWalletProvider === null) {
    this.isViewOnly = true
    this.isSetup = true
    this.onSetupFinished()
  }

  // Wait for the user to connect via web3modal.
  const walletProvider = await accountConnectedPromise

  let account: `0x${string}` | null = null

  try {
    const isOnMainnetEth = await getWalletIsOnEthMainnet(walletProvider)
    if (!isOnMainnetEth) {
      this.isMisconfigured = true
      this.onWalletAccountLoaded(null)
    }

    account = await getWalletAccount(walletProvider)
    this.onWalletAccountLoaded(account)

    if (!account) {
      this.isAccountMisconfigured = true
      this.hasValidAccount = false
    } else {
      // Rebuild the eth sdk with the user's wallet client wired in.
      attachSigner({ walletProvider: walletProvider as any, account })
      this.hasValidAccount = true
      this.isViewOnly = false
    }
  } catch (err) {
    console.error(err)
    this.isMisconfigured = true
    this.onWalletAccountLoaded(null)
  }

  this.isSetup = true
  this.onSetupFinished()
}
