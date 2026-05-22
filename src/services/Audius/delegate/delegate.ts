import BN from 'bn.js'
import { type Log } from 'viem'

import {
  DelegateClaimEvent,
  DelegateDecreaseStakeEvent,
  DelegateIncreaseStakeEvent,
  DelegateRemovedEvent,
  DelegateSlashEvent
} from 'models/TimelineEvents'
import { Address, Amount, BlockNumber, TxReceipt, Permission } from 'types'

import { AudiusClient } from '../AudiusClient'
import {
  asHex,
  contracts,
  EVENT_QUERY_START_BLOCK,
  getConnectedAccount,
  getEthPublicClient,
  read,
  toBN,
  toBig,
  writeAndWait
} from '../eth'

import {
  GetPendingUndelegateRequestResponse,
  UndelegateStakeResponse,
  RemoveDelegatorResponse
} from './types'

export type DelegateStakeResponse = {
  txReceipt: TxReceipt
  tokenApproveReceipt: { txReceipt: TxReceipt }
  delegator: Address
  serviceProvider: Address
  increaseAmount: BN
}

const requireAccount = (): Address => {
  const account = getConnectedAccount()
  if (!account) {
    throw new Error('No connected account')
  }
  return account
}

type EventLog<TArgs> = Log & { args: TArgs }

export default class Delegate {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Delegate Manager Client Read -------------------- */

  async getDelegatorsList(serviceProvider: Address): Promise<Address[]> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getDelegatorsList',
      args: [asHex(serviceProvider)]
    })) as readonly Address[]
    return [...info]
  }

  async getTotalDelegatedToServiceProvider(
    serviceProvider: Address
  ): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getTotalDelegatedToServiceProvider',
      args: [asHex(serviceProvider)]
    })) as bigint
    return toBN(info)
  }

  async getTotalDelegatorStake(delegator: Address): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getTotalDelegatorStake',
      args: [asHex(delegator)]
    })) as bigint
    return toBN(info)
  }

  async getTotalLockedDelegationForServiceProvider(
    serviceProvider: Address
  ): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getTotalLockedDelegationForServiceProvider',
      args: [asHex(serviceProvider)]
    })) as bigint
    return toBN(info)
  }

  async getDelegatorStakeForServiceProvider(
    delegator: Address,
    serviceProvider: Address
  ): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getDelegatorStakeForServiceProvider',
      args: [asHex(delegator), asHex(serviceProvider)]
    })) as bigint
    return toBN(info)
  }

  async getPendingUndelegateRequest(
    delegator: Address
  ): Promise<GetPendingUndelegateRequestResponse> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getPendingUndelegateRequest',
      args: [asHex(delegator)]
    })) as readonly [Address, bigint, bigint]
    return {
      target: info[0],
      amount: toBN(info[1]),
      lockupExpiryBlock: Number(info[2])
    }
  }

  async getPendingRemoveDelegatorRequest(
    serviceProvider: Address,
    delegator: Address
  ): Promise<{ lockupExpiryBlock: BlockNumber }> {
    await this.aud.hasPermissions()
    const lockupExpiryBlock = (await read({
      ...contracts.delegateManager(),
      functionName: 'getPendingRemoveDelegatorRequest',
      args: [asHex(serviceProvider), asHex(delegator)]
    })) as bigint
    return { lockupExpiryBlock: Number(lockupExpiryBlock) }
  }

  async getUndelegateLockupDuration(): Promise<BlockNumber> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getUndelegateLockupDuration'
    })) as bigint
    return Number(info)
  }

  async getMaxDelegators(): Promise<number> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getMaxDelegators'
    })) as bigint
    return Number(info)
  }

  async getMinDelegationAmount(): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getMinDelegationAmount'
    })) as bigint
    return toBN(info)
  }

  async getRemoveDelegatorLockupDuration(): Promise<BlockNumber> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getRemoveDelegatorLockupDuration'
    })) as bigint
    return Number(info)
  }

  async getRemoveDelegatorEvalDuration(): Promise<BlockNumber> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.delegateManager(),
      functionName: 'getRemoveDelegatorEvalDuration'
    })) as bigint
    return Number(info)
  }

  async getGovernanceAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.delegateManager(),
      functionName: 'getGovernanceAddress'
    })) as Address
  }

  async getServiceProviderFactoryAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.delegateManager(),
      functionName: 'getServiceProviderFactoryAddress'
    })) as Address
  }

  async getClaimsManagerAddress(): Promise<Address> {
    await this.aud.hasPermissions()
    return (await read({
      ...contracts.delegateManager(),
      functionName: 'getClaimsManagerAddress'
    })) as Address
  }

  async getSPMinDelegationAmount(serviceProvider: Address): Promise<BN> {
    await this.aud.hasPermissions()
    const minDelegationAmount = (await read({
      ...contracts.delegateManager(),
      functionName: 'getSPMinDelegationAmount',
      args: [asHex(serviceProvider)]
    })) as bigint
    return toBN(minDelegationAmount)
  }

  /* -------------------- Event helpers -------------------- */

  private async getEvents<TArgs>(
    eventName: string,
    args?: Record<string, unknown>
  ): Promise<Array<EventLog<TArgs>>> {
    return (await getEthPublicClient().getContractEvents({
      ...contracts.delegateManager(),
      eventName,
      args,
      fromBlock: EVENT_QUERY_START_BLOCK
    } as any)) as unknown as Array<EventLog<TArgs>>
  }

  async getIncreaseDelegateStakeEvents({
    delegator,
    serviceProvider
  }: {
    delegator?: Address
    serviceProvider?: Address
  }): Promise<DelegateIncreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _delegator: Address
      _serviceProvider: Address
      _increaseAmount: bigint
    }>('IncreaseDelegatedStake', {
      ...(delegator && { _delegator: asHex(delegator) }),
      ...(serviceProvider && { _serviceProvider: asHex(serviceProvider) })
    })
    return events.map((event) => ({
      _type: 'DelegateIncreaseStake',
      direction: delegator ? 'Sent' : 'Received',
      blockNumber: Number(event.blockNumber),
      delegator: event.args._delegator,
      serviceProvider: event.args._serviceProvider,
      increaseAmount: toBN(event.args._increaseAmount)
    }))
  }

  /** Can filter either by delegator or SP */
  async getDecreaseDelegateStakeEvaluatedEvents({
    delegator,
    serviceProvider
  }: {
    delegator?: Address
    serviceProvider?: Address
  }): Promise<DelegateDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _delegator: Address
      _serviceProvider: Address
      _amount: bigint
    }>('UndelegateStakeRequestEvaluated', {
      ...(delegator && { _delegator: asHex(delegator) }),
      ...(serviceProvider && { _serviceProvider: asHex(serviceProvider) })
    })
    return events.map((event) => ({
      _type: 'DelegateDecreaseStake',
      direction: delegator ? 'Sent' : 'Received',
      blockNumber: Number(event.blockNumber),
      delegator: event.args._delegator,
      amount: toBN(event.args._amount),
      serviceProvider: event.args._serviceProvider,
      data: { _type: 'Evaluated' }
    }))
  }

  /** Can filter either by delegator or SP */
  async getUndelegateStakeRequestedEvents({
    serviceProvider,
    delegator
  }: {
    serviceProvider?: Address
    delegator?: Address
  }): Promise<DelegateDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _delegator: Address
      _serviceProvider: Address
      _amount: bigint
      _lockupExpiryBlock: bigint
    }>('UndelegateStakeRequested', {
      ...(delegator && { _delegator: asHex(delegator) }),
      ...(serviceProvider && { _serviceProvider: asHex(serviceProvider) })
    })
    return events.map((event) => ({
      _type: 'DelegateDecreaseStake',
      direction: delegator ? 'Sent' : 'Received',
      blockNumber: Number(event.blockNumber),
      delegator: event.args._delegator,
      amount: toBN(event.args._amount),
      serviceProvider: event.args._serviceProvider,
      data: {
        _type: 'Requested',
        lockupExpiryBlock: Number(event.args._lockupExpiryBlock)
      }
    }))
  }

  /** Can filter either by delegator or SP */
  async getUndelegateStakeCancelledEvents({
    serviceProvider,
    delegator
  }: {
    serviceProvider?: Address
    delegator?: Address
  }): Promise<DelegateDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _delegator: Address
      _serviceProvider: Address
      _amount: bigint
    }>('UndelegateStakeRequestCancelled', {
      ...(delegator && { _delegator: asHex(delegator) }),
      ...(serviceProvider && { _serviceProvider: asHex(serviceProvider) })
    })
    return events.map((event) => ({
      _type: 'DelegateDecreaseStake',
      direction: delegator ? 'Sent' : 'Received',
      blockNumber: Number(event.blockNumber),
      delegator: event.args._delegator,
      amount: toBN(event.args._amount),
      serviceProvider: event.args._serviceProvider,
      data: { _type: 'Cancelled' }
    }))
  }

  async getClaimEvents(claimer: Address): Promise<DelegateClaimEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _claimer: Address
      _rewards: bigint
      _newTotal: bigint
    }>('Claim', { _claimer: asHex(claimer) })
    return events.map((event) => ({
      _type: 'DelegateClaim',
      blockNumber: Number(event.blockNumber),
      claimer: event.args._claimer,
      rewards: toBN(event.args._rewards),
      newTotal: toBN(event.args._newTotal)
    }))
  }

  async getSlashEvents(target: Address): Promise<DelegateSlashEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _target: Address
      _amount: bigint
      _newTotal: bigint
    }>('Slash', { _target: asHex(target) })
    return events.map((event) => ({
      _type: 'DelegateSlash',
      blockNumber: Number(event.blockNumber),
      target: event.args._target,
      amount: toBN(event.args._amount),
      newTotal: toBN(event.args._newTotal)
    }))
  }

  /**
   * Legacy emitted a "DelegateRemoved" timeline event using the same event
   * stream as DecreaseDelegateStake. Preserved here for shape parity with
   * the old API.
   */
  async getDelegatorRemovedEvents(
    delegator: Address
  ): Promise<DelegateRemovedEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _delegator: Address
      _serviceProvider: Address
      _unstakedAmount: bigint
    }>('RemoveDelegatorRequestEvaluated', {
      _delegator: asHex(delegator)
    })
    return events.map((event) => ({
      _type: 'DelegateRemoved',
      blockNumber: Number(event.blockNumber),
      delegator: event.args._delegator,
      serviceProvider: event.args._serviceProvider,
      unstakedAmount: toBN(event.args._unstakedAmount)
    }))
  }

  /* -------------------- Delegate Manager Client Write -------------------- */

  /**
   * delegateStake requires an ERC-20 approve on the AUDIO token to the
   * DelegateManager contract first (the contract calls `transferFrom`).
   * The legacy SDK did both steps and returned both receipts; we replicate
   * that shape so consumers don't change.
   */
  async delegateStake(
    targetSP: Address,
    amount: Amount
  ): Promise<DelegateStakeResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const delegator = requireAccount()
    const amountBig = toBig(amount)

    const tokenApproveReceipt = await writeAndWait({
      ...contracts.audiusToken(),
      functionName: 'approve',
      args: [contracts.delegateManager().address, amountBig]
    })

    const txReceipt = await writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'delegateStake',
      args: [asHex(targetSP), amountBig]
    })

    return {
      txReceipt,
      tokenApproveReceipt: { txReceipt: tokenApproveReceipt },
      delegator,
      serviceProvider: targetSP,
      increaseAmount: new BN(amount.toString())
    }
  }

  async requestUndelegateStake(
    targetSP: Address,
    amount: Amount
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'requestUndelegateStake',
      args: [asHex(targetSP), toBig(amount)]
    })
  }

  async cancelUndelegateStakeRequest(): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'cancelUndelegateStakeRequest'
    })
  }

  async undelegateStake(): Promise<UndelegateStakeResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const delegator = requireAccount()
    // Snapshot the pending request before we evaluate it — afterwards the
    // request is cleared on-chain and we lose the target / amount.
    const pending = await this.getPendingUndelegateRequest(delegator)
    await writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'undelegateStake'
    })
    return {
      delegator,
      serviceProvider: pending.target,
      decreaseAmount: pending.amount
    }
  }

  async claimRewards(serviceProvider: Address): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'claimRewards',
      args: [asHex(serviceProvider)]
    })
  }

  async requestRemoveDelegator(
    serviceProvider: Address,
    delegator: Address
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'requestRemoveDelegator',
      args: [asHex(serviceProvider), asHex(delegator)]
    })
  }

  async cancelRemoveDelegatorRequest(
    serviceProvider: Address,
    delegator: Address
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'cancelRemoveDelegatorRequest',
      args: [asHex(serviceProvider), asHex(delegator)]
    })
  }

  async removeDelegator(
    serviceProvider: Address,
    delegator: Address
  ): Promise<RemoveDelegatorResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    // Snapshot the delegator's current stake to the SP so we can report
    // the unstaked amount in the legacy response shape.
    const stake = await this.getDelegatorStakeForServiceProvider(
      delegator,
      serviceProvider
    )
    await writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'removeDelegator',
      args: [asHex(serviceProvider), asHex(delegator)]
    })
    return {
      delegator,
      serviceProvider,
      unstakedAmount: stake
    }
  }

  async updateSPMinDelegationAmount(
    serviceProvider: Address,
    amount: Amount
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.delegateManager(),
      functionName: 'updateSPMinDelegationAmount',
      args: [asHex(serviceProvider), toBig(amount)]
    })
  }
}
