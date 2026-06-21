import BN from 'bn.js'

import { Address, BlockNumber } from 'types'

import { AudiusClient } from '../AudiusClient'
import { asHex, contracts, read, toBN } from '../eth'

export default class Staking {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Staking Proxy Client Read -------------------- */

  async token(): Promise<Address> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'token'
    })) as Address
    return info
  }

  async totalStaked(): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'totalStaked'
    })) as bigint
    return toBN(info)
  }

  async supportsHistory(): Promise<boolean> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'supportsHistory'
    })) as boolean
    return info
  }

  async totalStakedFor(account: Address): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'totalStakedFor',
      args: [asHex(account)]
    })) as bigint
    return toBN(info)
  }

  async totalStakedForAt(
    account: Address,
    blockNumber: BlockNumber
  ): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'totalStakedForAt',
      args: [asHex(account), BigInt(blockNumber)]
    })) as bigint
    return toBN(info)
  }

  async totalStakedAt(blockNumber: BlockNumber): Promise<BN> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'totalStakedAt',
      args: [BigInt(blockNumber)]
    })) as bigint
    return toBN(info)
  }

  async isStaker(account: Address): Promise<boolean> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.staking(),
      functionName: 'isStaker',
      args: [asHex(account)]
    })) as boolean
    return info
  }
}
