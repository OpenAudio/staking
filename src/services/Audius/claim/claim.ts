import { type Log } from 'viem'

import { ClaimProcessedEvent } from 'models/TimelineEvents'
import { BlockNumber, Address, TxReceipt } from 'types'

import { AudiusClient } from '../AudiusClient'
import {
  asHex,
  contracts,
  getEthPublicClient,
  read,
  toBN,
  writeAndWait
} from '../eth'

/** Re-export the dashboard's TxReceipt shape so existing imports keep working. */
export type TransactionReceipt = TxReceipt

export default class Claim {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Claims Manager Client Read -------------------- */

  /** Duration of a funding round in blocks. */
  async getFundingRoundBlockDiff(): Promise<BlockNumber> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.claimsManager(),
      functionName: 'getFundingRoundBlockDiff'
    })) as bigint
    return Number(info)
  }

  /** Last block where a funding round was initiated. */
  async getLastFundedBlock(): Promise<BlockNumber> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.claimsManager(),
      functionName: 'getLastFundedBlock'
    })) as bigint
    return Number(info)
  }

  /** Amount funded per round in wei. */
  async getFundsPerRound() {
    await this.aud.hasPermissions()
    const claimAmount = (await read({
      ...contracts.claimsManager(),
      functionName: 'getFundsPerRound'
    })) as bigint
    return toBN(claimAmount)
  }

  /** Total amount claimed in the current round. */
  async getTotalClaimedInRound() {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.claimsManager(),
      functionName: 'getTotalClaimedInRound'
    })) as bigint
    return toBN(info)
  }

  async getGovernanceAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.claimsManager(),
      functionName: 'getGovernanceAddress'
    })) as Address
  }

  async getServiceProviderFactoryAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.claimsManager(),
      functionName: 'getServiceProviderFactoryAddress'
    })) as Address
  }

  async getDelegateManagerAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.claimsManager(),
      functionName: 'getDelegateManagerAddress'
    })) as Address
  }

  async getStakingAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.claimsManager(),
      functionName: 'getStakingAddress'
    })) as Address
  }

  /** Is a claim currently pending for the given service provider address? */
  async claimPending(address: Address): Promise<boolean> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.claimsManager(),
      functionName: 'claimPending',
      args: [asHex(address)]
    })) as boolean
  }

  /* -------------------- Claims Manager Client Write -------------------- */

  /**
   * Initiates a new funding round on-chain. Anyone may call this once the
   * previous round's block window has elapsed.
   */
  async initiateRound(): Promise<TxReceipt> {
    await this.aud.hasPermissions()
    return writeAndWait({
      ...contracts.claimsManager(),
      functionName: 'initiateRound'
    })
  }

  /* -------------------- Event helpers -------------------- */

  /**
   * Returns the round number of the last initiated funding round by inspecting
   * the most recent `RoundInitiated` event from the ClaimsManager.
   */
  async getCurrentRound(): Promise<number | null> {
    await this.aud.hasPermissions()
    const latestFundedBlockNumber = await this.getLastFundedBlock()
    const events = await getEthPublicClient().getContractEvents({
      ...contracts.claimsManager(),
      eventName: 'RoundInitiated',
      fromBlock: BigInt(latestFundedBlockNumber),
      toBlock: BigInt(latestFundedBlockNumber)
    } as any)
    const event = events[0] as
      | (Log & { args?: { _roundNumber?: bigint } })
      | undefined
    return event?.args?._roundNumber != null
      ? Number(event.args._roundNumber)
      : null
  }

  /** All ClaimProcessed events emitted with the given claimer. */
  async getClaimProcessedEvents(
    claimer: Address
  ): Promise<ClaimProcessedEvent[]> {
    await this.aud.hasPermissions()
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.claimsManager(),
      eventName: 'ClaimProcessed',
      args: { _claimer: asHex(claimer) },
      fromBlock: 0n
    } as any)) as unknown as Array<
      Log & {
        args: {
          _claimer: Address
          _rewards: bigint
          _oldTotal: bigint
          _newTotal: bigint
        }
      }
    >
    return events.map((e) => ({
      _type: 'ClaimProcessed',
      blockNumber: Number(e.blockNumber),
      claimer: e.args._claimer,
      rewards: toBN(e.args._rewards),
      oldTotal: toBN(e.args._oldTotal),
      newTotal: toBN(e.args._newTotal)
    }))
  }
}
