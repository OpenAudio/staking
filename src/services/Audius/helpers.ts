import BN from 'bn.js'
import { decodeAbiParameters, getAddress, type AbiParameter } from 'viem'

import { BigNumber, Permission, Proposal } from 'types'
import { fetchWithTimeout } from 'utils/fetch'
import { formatAudString, formatNumber } from 'utils/format'

import AudiusClient from './AudiusClient'
import {
  asHex,
  getConnectedAccount,
  getEthPublicClient
} from './eth'

// Helpers
export async function hasPermissions(
  this: AudiusClient,
  ...permissions: Array<Permission>
) {
  await this.awaitSetup()
  if (permissions.includes(Permission.WRITE) && !this.hasValidAccount) {
    throw new Error('Libs not configured')
  }
}

export function onSetup(this: AudiusClient) {
  this.isSetupPromise = new Promise((resolve) => {
    this._setupPromiseResolve = resolve
  })
  this.walletAccountLoadedPromise = new Promise((resolve) => {
    this._metaMaskAccountLoadedResolve = resolve
  })
}

export function onWalletAccountLoaded(
  this: AudiusClient,
  account: string | null
) {
  this.isMetaMaskAccountLoaded = true
  if (this._metaMaskAccountLoadedResolve) {
    this._metaMaskAccountLoadedResolve(account)
  }
}

export function onSetupFinished(this: AudiusClient) {
  if (this._setupPromiseResolve) {
    this._setupPromiseResolve()
  }
}

export async function awaitSetup(this: AudiusClient): Promise<void> {
  return this.isSetupPromise
}

export async function getEthBlockNumber(this: AudiusClient): Promise<number> {
  await this.hasPermissions()
  const blockNumber = await getEthPublicClient().getBlockNumber()
  return Number(blockNumber)
}

export async function getEthWallet(
  this: AudiusClient
): Promise<string | undefined> {
  await this.hasPermissions()
  return getConnectedAccount()
}

export async function isEoa(this: AudiusClient, wallet: string) {
  const code = await getEthPublicClient().getCode({ address: asHex(wallet) })
  // viem returns undefined for accounts with no bytecode (EOAs).
  return code === undefined || code === '0x'
}

export async function getAverageBlockTime(this: AudiusClient): Promise<number> {
  await this.hasPermissions()
  const publicClient = getEthPublicClient()
  const span = 1000
  const currentNumber = Number(await publicClient.getBlockNumber())
  const currentBlock = await publicClient.getBlock({
    blockNumber: BigInt(currentNumber)
  })
  let firstBlock
  try {
    firstBlock = await publicClient.getBlock({
      blockNumber: BigInt(currentNumber - span)
    })
  } catch (e) {
    firstBlock = await publicClient.getBlock({ blockNumber: 1n })
  }
  return Math.round(
    (Number(currentBlock.timestamp) - Number(firstBlock.timestamp)) / span
  )
}

export async function getBlock(this: AudiusClient, blockNumber: number) {
  await this.hasPermissions()
  return getEthPublicClient().getBlock({ blockNumber: BigInt(blockNumber) })
}

export async function getBlockNearTimestamp(
  this: AudiusClient,
  averageBlockTime: number,
  currentBlockNumber: number,
  timestamp: number
) {
  await this.hasPermissions()
  const publicClient = getEthPublicClient()
  const now = new Date()
  const then = new Date(timestamp)
  // @ts-ignore: date subtraction works
  const seconds = (now - then) / 1000
  const blocks = Math.round(seconds / averageBlockTime)
  const targetNumber = Math.max(currentBlockNumber - blocks, 0)
  return publicClient.getBlock({ blockNumber: BigInt(targetNumber) })
}

export async function toChecksumAddress(this: AudiusClient, wallet: string) {
  await this.awaitSetup()
  return getAddress(wallet)
}

// Static Helpers
export function getBNPercentage(
  n1: BigNumber,
  n2: BigNumber,
  decimals: number = 2
): number {
  const divisor = Math.pow(10, decimals + 1)
  if (n2.toString() === '0') return 0
  const num = n1.mul(new BN(divisor.toString())).div(n2)
  if (num.gte(new BN(divisor.toString()))) return 1
  return num.toNumber() / divisor
}

export function displayShortAud(amount: BigNumber) {
  return formatNumber(amount.div(new BN('1000000000000000000') as BN))
}

export function displayAud(amount: BigNumber) {
  return formatAudString(getAud(amount))
}

export function getAud(amount: BigNumber) {
  const aud = amount.div(new BN('1000000000000000000'))
  const wei = amount.sub(aud.mul(new BN('1000000000000000000')))
  if (wei.isZero()) {
    return aud.toString()
  }
  const decimals = wei.toString().padStart(18, '0')
  return `${aud}.${trimRightZeros(decimals)}`
}

export function trimRightZeros(number: string) {
  return number.replace(/(\d)0+$/gm, '$1')
}

export function getWei(amount: BigNumber) {
  return amount.mul(new BN('1000000000000000000'))
}

type NodeMetadata = {
  version: string
  country: string
}

/**
 * @deprecated Replaced with methods below. Can be removed after all nodes update to version 0.3.58
 */
export async function getNodeMetadata(endpoint: string): Promise<NodeMetadata> {
  try {
    const { data } = await fetchWithTimeout(
      `${endpoint}/health_check?verbose=true`
    )
    const { version, country } = data
    return { version, country }
  } catch (e) {
    console.error(e)
    // Return no version if we couldn't find one, so we don't hold everything up
    return { version: '', country: '' }
  }
}

export async function getDiscoveryNodeMetadata(
  endpoint: string
): Promise<NodeMetadata> {
  try {
    const {
      data: { country },
      version: { version }
    } = await fetchWithTimeout(`${endpoint}/location?verbose=true`)
    return { version, country }
  } catch (e) {
    // Try legacy method:
    return await getNodeMetadata(endpoint)
  }
}

export async function getContentNodeMetadata(
  endpoint: string
): Promise<NodeMetadata> {
  try {
    const {
      data: { country, version }
    } = await fetchWithTimeout(`${endpoint}/version`)
    return { version, country }
  } catch (e) {
    // Try legacy method:
    return await getNodeMetadata(endpoint)
  }
}

export async function getValidatorMetadata(
  endpoint: string
): Promise<NodeMetadata> {
  try {
    const {
      data: { country, version }
    } = await fetchWithTimeout(`${endpoint}/version`)
    return { version, country }
  } catch (e) {
    // Try legacy method:
    return await getNodeMetadata(endpoint)
  }
}

/**
 * Decode an ABI-encoded call data blob into a positional array.
 *
 * The legacy implementation used web3.js's `eth.abi.decodeParameters` which
 * returned an object with both positional and named keys plus a magic
 * `__length__` field; consumers then called `Object.values(decoded)` to get
 * back a positional array. viem's `decodeAbiParameters` returns the
 * positional tuple directly, so we project the same result without the
 * `__length__` dance.
 *
 * `types` is the legacy Solidity-style array (e.g. `['address', 'uint256']`).
 */
export function decodeCallData(types: string[], callData: string): unknown[] {
  const params: AbiParameter[] = types.map((type) => ({ type }))
  const decoded = decodeAbiParameters(
    params,
    callData as `0x${string}`
  ) as unknown as unknown[]
  return [...decoded]
}

export function decodeProposalCallData(proposal: Proposal) {
  const signatureSplit = proposal.functionSignature.split('(')
  const functionName = signatureSplit?.[0]

  const types = signatureSplit?.[1]?.split(')')?.[0]?.split(',')
  if (!types) {
    return null
  }
  const parsedCallData = AudiusClient.decodeCallData(types, proposal.callData)
  if (functionName === 'slash') {
    parsedCallData[0] = new BN(String(parsedCallData[0])).toString() + '(wei)'
  }
  const joinedCallData = parsedCallData.join(',')
  return joinedCallData
}
