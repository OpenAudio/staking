import { type Log, hexToString, stringToHex, type Hex } from 'viem'

import {
  ServiceProviderDecreaseStakeEvent,
  ServiceProviderDeregisteredEvent,
  ServiceProviderIncreaseStakeEvent,
  ServiceProviderRegisteredEvent
} from 'models/TimelineEvents'
import {
  ServiceType,
  Address,
  Amount,
  BlockNumber,
  ServiceProvider,
  TxReceipt,
  Node,
  Permission,
  Wallet
} from 'types'

import { AudiusClient } from '../AudiusClient'
import {
  asHex,
  contracts,
  getConnectedAccount,
  getEthPublicClient,
  read,
  simulate,
  toBig,
  toBN,
  writeAndWait
} from '../eth'

import {
  GetPendingDecreaseStakeRequestResponse,
  GetServiceProviderIdsFromAddressResponse,
  GetServiceEndpointInfoFromAddressResponse,
  GetServiceProviderListResponse,
  RegisterWithDelegateResponse,
  RegisterResponse,
  IncreaseStakeResponse,
  DecreaseStakeResponse,
  DeregisterResponse
} from './types'

const encodeServiceType = (serviceType: ServiceType): Hex =>
  stringToHex(serviceType, { size: 32 })

const decodeServiceType = (value: Hex): ServiceType =>
  hexToString(value, { size: 32 }) as ServiceType

const requireAccount = (): Address => {
  const account = getConnectedAccount()
  if (!account) throw new Error('No connected account')
  return account
}

type EventLog<TArgs> = Log & { args: TArgs }

export default class ServiceProviderClient {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Service Provider Read -------------------- */

  async getTotalServiceTypeProviders(
    serviceType: ServiceType
  ): Promise<number> {
    await this.aud.hasPermissions()
    const numberServiceProviders = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getTotalServiceTypeProviders',
      args: [encodeServiceType(serviceType)]
    })) as bigint
    return Number(numberServiceProviders)
  }

  async getServiceProviderIdFromEndpoint(endpoint: string): Promise<number> {
    await this.aud.hasPermissions()
    const spId = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getServiceProviderIdFromEndpoint',
      args: [endpoint]
    })) as bigint
    return Number(spId)
  }

  async getServiceEndpointInfo(
    serviceType: ServiceType,
    spID: number
  ): Promise<Node> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getServiceEndpointInfo',
      args: [encodeServiceType(serviceType), BigInt(spID)]
    })) as readonly [Address, string, bigint, Address]
    return {
      owner: info[0],
      endpoint: info[1],
      blockNumber: Number(info[2]),
      delegateOwnerWallet: info[3],
      spID,
      type: serviceType,
      country: ''
    }
  }

  async getServiceProviderIdsFromAddress(
    ownerAddress: Address,
    serviceType: ServiceType
  ): Promise<GetServiceProviderIdsFromAddressResponse> {
    await this.aud.hasPermissions()
    const ids = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getServiceProviderIdsFromAddress',
      args: [asHex(ownerAddress), encodeServiceType(serviceType)]
    })) as readonly bigint[]
    return ids.map((id) => Number(id))
  }

  async getPendingDecreaseStakeRequest(
    account: Address
  ): Promise<GetPendingDecreaseStakeRequestResponse> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getPendingDecreaseStakeRequest',
      args: [asHex(account)]
    })) as readonly [bigint, bigint]
    return {
      amount: toBN(info[0]),
      lockupExpiryBlock: Number(info[1])
    }
  }

  async cancelDecreaseStakeRequest(account: Address): Promise<void> {
    await this.aud.hasPermissions(Permission.WRITE)
    await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'cancelDecreaseStakeRequest',
      args: [asHex(account)]
    })
  }

  async getServiceProviderDetails(account: Address): Promise<ServiceProvider> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getServiceProviderDetails',
      args: [asHex(account)]
    })) as readonly [bigint, bigint, boolean, bigint, bigint, bigint]
    return {
      deployerStake: toBN(info[0]),
      deployerCut: Number(info[1]),
      validBounds: info[2],
      numberOfEndpoints: Number(info[3]),
      minAccountStake: toBN(info[4]),
      maxAccountStake: toBN(info[5])
    }
  }

  async getPendingUpdateDeployerCutRequest(
    ownerAddress: Address
  ): Promise<{ newDeployerCut: number; lockupExpiryBlock: number }> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getPendingUpdateDeployerCutRequest',
      args: [asHex(ownerAddress)]
    })) as readonly [bigint, bigint]
    return {
      newDeployerCut: Number(info[0]),
      lockupExpiryBlock: Number(info[1])
    }
  }

  async getDecreaseStakeLockupDuration(): Promise<number> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getDecreaseStakeLockupDuration'
    })) as bigint
    return Number(info)
  }

  async getDeployerCutLockupDuration(): Promise<number> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceProviderFactory(),
      functionName: 'getDeployerCutLockupDuration'
    })) as bigint
    return Number(info)
  }

  /**
   * Returns the full list of registered nodes of `serviceType`. Iterates spID
   * 1..totalProviders calling `getServiceEndpointInfo` for each, in parallel.
   * Deregistered nodes (empty endpoint) are included so callers can flag them.
   *
   * The legacy SDK exposed this directly; on-chain there's no batch read so
   * we fan out here.
   */
  async getServiceProviderList(
    serviceType: ServiceType
  ): Promise<GetServiceProviderListResponse> {
    await this.aud.hasPermissions()
    const total = await this.getTotalServiceTypeProviders(serviceType)
    if (total === 0) return []
    const ids = Array.from({ length: total }, (_, i) => i + 1)
    return Promise.all(
      ids.map((spID) => this.getServiceEndpointInfo(serviceType, spID))
    )
  }

  /**
   * Convenience equivalent to the legacy `getServiceEndpointInfoFromAddress`,
   * but kept for any downstream that needs it. Composes
   * `getServiceProviderIdsFromAddress` with `getServiceEndpointInfo`.
   */
  async getServiceEndpointInfoFromAddress(
    ownerAddress: Address,
    serviceType: ServiceType
  ): Promise<GetServiceEndpointInfoFromAddressResponse> {
    await this.aud.hasPermissions()
    const ids = await this.getServiceProviderIdsFromAddress(
      ownerAddress,
      serviceType
    )
    return Promise.all(
      ids.map((spID) => this.getServiceEndpointInfo(serviceType, spID))
    )
  }

  /**
   * Look up the historical endpoint / wallet of a deregistered node by
   * scanning DeregisteredServiceProvider events filtered to (serviceType,
   * spID). The legacy SDK exposed a contract helper; on the modern ABI we
   * read from event logs.
   */
  async getDeregisteredService(
    serviceType: ServiceType,
    spID: number
  ): Promise<{
    delegateOwnerWallet: Address
    endpoint: string
    owner: Wallet
  }> {
    await this.aud.hasPermissions()
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.serviceProviderFactory(),
      eventName: 'DeregisteredServiceProvider',
      args: {
        _serviceType: encodeServiceType(serviceType),
        _spID: BigInt(spID)
      },
      fromBlock: 0n
    } as any)) as unknown as Array<
      EventLog<{
        _owner: Address
        _endpoint: string
      }>
    >
    const event = events[events.length - 1]
    return {
      owner: event?.args?._owner ?? '',
      endpoint: event?.args?._endpoint ?? '',
      delegateOwnerWallet: event?.args?._owner ?? ''
    }
  }

  /* -------------------- Event helpers -------------------- */

  private async getEvents<TArgs>(
    eventName: string,
    args?: Record<string, unknown>
  ): Promise<Array<EventLog<TArgs>>> {
    return (await getEthPublicClient().getContractEvents({
      ...contracts.serviceProviderFactory(),
      eventName,
      args,
      fromBlock: 0n
    } as any)) as unknown as Array<EventLog<TArgs>>
  }

  async getRegisteredServiceProviderEvents(
    wallet: Address
  ): Promise<ServiceProviderRegisteredEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _spID: bigint
      _serviceType: Hex
      _endpoint: string
      _stakeAmount: bigint
    }>('RegisteredServiceProvider', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderRegistered',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      spID: Number(event.args._spID),
      serviceType: decodeServiceType(event.args._serviceType),
      endpoint: event.args._endpoint,
      stakeAmount: toBN(event.args._stakeAmount)
    }))
  }

  async getDeregisteredServiceProviderEvents(
    wallet: Address
  ): Promise<ServiceProviderDeregisteredEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _spID: bigint
      _serviceType: Hex
      _endpoint: string
      _unstakedAmount: bigint
    }>('DeregisteredServiceProvider', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderDeregistered',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      spID: Number(event.args._spID),
      serviceType: decodeServiceType(event.args._serviceType),
      endpoint: event.args._endpoint,
      stakeAmount: toBN(event.args._unstakedAmount)
    }))
  }

  async getIncreasedStakeEvents(
    wallet: Address
  ): Promise<ServiceProviderIncreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _increaseAmount: bigint
      _newStakeAmount: bigint
    }>('IncreasedStake', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderIncreaseStake',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      increaseAmount: toBN(event.args._increaseAmount),
      newStakeAmount: toBN(event.args._newStakeAmount)
    }))
  }

  async getDecreasedStakeEvaluatedEvents(
    wallet: Address
  ): Promise<ServiceProviderDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _decreaseAmount: bigint
      _newStakeAmount: bigint
    }>('DecreaseStakeRequestEvaluated', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderDecreaseStake',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      decreaseAmount: toBN(event.args._decreaseAmount),
      data: {
        newStakeAmount: toBN(event.args._newStakeAmount),
        _type: 'Evaluated'
      }
    }))
  }

  async getDecreasedStakeRequestedEvents(
    wallet: Address
  ): Promise<ServiceProviderDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _decreaseAmount: bigint
      _lockupExpiryBlock: bigint
    }>('DecreaseStakeRequested', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderDecreaseStake',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      decreaseAmount: toBN(event.args._decreaseAmount),
      data: {
        lockupExpiryBlock: Number(event.args._lockupExpiryBlock),
        _type: 'Requested'
      }
    }))
  }

  async getDecreasedStakeCancelledEvents(
    wallet: Address
  ): Promise<ServiceProviderDecreaseStakeEvent[]> {
    await this.aud.hasPermissions()
    const events = await this.getEvents<{
      _owner: Address
      _decreaseAmount: bigint
      _lockupExpiryBlock: bigint
    }>('DecreaseStakeRequestCancelled', { _owner: asHex(wallet) })
    return events.map((event) => ({
      _type: 'ServiceProviderDecreaseStake',
      blockNumber: Number(event.blockNumber),
      owner: event.args._owner,
      decreaseAmount: toBN(event.args._decreaseAmount),
      data: {
        lockupExpiryBlock: Number(event.args._lockupExpiryBlock),
        _type: 'Cancelled'
      }
    }))
  }

  /* -------------------- Service Provider Write -------------------- */

  /**
   * Internal helper: ERC-20 approve AUDIO to the ServiceProviderFactory
   * (required before any register/increaseStake call).
   */
  private async approveStake(amount: Amount): Promise<TxReceipt> {
    return writeAndWait({
      ...contracts.audiusToken(),
      functionName: 'approve',
      args: [contracts.serviceProviderFactory().address, toBig(amount)]
    })
  }

  /**
   * Simulate then register. The returned spID comes from the simulation
   * (the on-chain register function returns uint256 spID), so consumers
   * get the full legacy response shape without parsing receipt logs.
   */
  async registerWithDelegate(
    serviceType: ServiceType,
    endpoint: string,
    amount: Amount,
    delegateOwnerWallet: Address
  ): Promise<RegisterWithDelegateResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const owner = requireAccount()
    const tokenApproveReceipt = await this.approveStake(amount)
    const { result: spIdBig } = (await simulate({
      ...contracts.serviceProviderFactory(),
      functionName: 'register',
      args: [
        encodeServiceType(serviceType),
        endpoint,
        toBig(amount),
        asHex(delegateOwnerWallet)
      ],
      account: owner as Hex
    })) as { result: bigint }
    const txReceipt = await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'register',
      args: [
        encodeServiceType(serviceType),
        endpoint,
        toBig(amount),
        asHex(delegateOwnerWallet)
      ]
    })
    return {
      txReceipt,
      tokenApproveReceipt,
      spID: Number(spIdBig),
      serviceType,
      owner,
      endpoint
    }
  }

  async register(
    serviceType: ServiceType,
    endpoint: string,
    amount: Amount
  ): Promise<RegisterResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const owner = requireAccount()
    // Legacy "register" wired delegate = owner; on-chain there's only the
    // 4-arg register, so we forward owner as the delegate.
    return this.registerWithDelegate(serviceType, endpoint, amount, owner)
  }

  async increaseStake(amount: Amount): Promise<IncreaseStakeResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const tokenApproveReceipt = await this.approveStake(amount)
    const txReceipt = await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'increaseStake',
      args: [toBig(amount)]
    })
    return { txReceipt, tokenApproveReceipt: { txReceipt: tokenApproveReceipt } }
  }

  async requestDecreaseStake(amount: Amount): Promise<BlockNumber> {
    await this.aud.hasPermissions(Permission.WRITE)
    const owner = requireAccount()
    const { result: lockupBig } = (await simulate({
      ...contracts.serviceProviderFactory(),
      functionName: 'requestDecreaseStake',
      args: [toBig(amount)],
      account: owner as Hex
    })) as { result: bigint }
    await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'requestDecreaseStake',
      args: [toBig(amount)]
    })
    return Number(lockupBig)
  }

  async decreaseStake(): Promise<DecreaseStakeResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const txReceipt = await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'decreaseStake'
    })
    return { txReceipt }
  }

  async deregister(
    serviceType: ServiceType,
    endpoint: string
  ): Promise<DeregisterResponse> {
    await this.aud.hasPermissions(Permission.WRITE)
    const owner = requireAccount()
    const spID = await this.getServiceProviderIdFromEndpoint(endpoint)
    const txReceipt = await writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'deregister',
      args: [encodeServiceType(serviceType), endpoint]
    })
    return { txReceipt, spID, serviceType, owner, endpoint }
  }

  async updateDelegateOwnerWallet(
    serviceType: ServiceType,
    endpoint: string,
    updatedDelegateOwnerWallet: Address
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'updateDelegateOwnerWallet',
      args: [
        encodeServiceType(serviceType),
        endpoint,
        asHex(updatedDelegateOwnerWallet)
      ]
    })
  }

  async updateEndpoint(
    serviceType: ServiceType,
    oldEndpoint: string,
    newEndpoint: string
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'updateEndpoint',
      args: [encodeServiceType(serviceType), oldEndpoint, newEndpoint]
    })
  }

  async requestUpdateDeployerCut(
    ownerAddress: Address,
    deployerCut: number
  ): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'requestUpdateDeployerCut',
      args: [asHex(ownerAddress), BigInt(deployerCut)]
    })
  }

  async cancelUpdateDeployerCut(ownerAddress: Address): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'cancelUpdateDeployerCut',
      args: [asHex(ownerAddress)]
    })
  }

  async updateDeployerCut(ownerAddress: Address): Promise<TxReceipt> {
    await this.aud.hasPermissions(Permission.WRITE)
    return writeAndWait({
      ...contracts.serviceProviderFactory(),
      functionName: 'updateDeployerCut',
      args: [asHex(ownerAddress)]
    })
  }
}
