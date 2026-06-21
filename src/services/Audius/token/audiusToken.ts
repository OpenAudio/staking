import { Address, BigNumber } from 'types'

import { AudiusClient } from '../AudiusClient'
import { asHex, contracts, read, toBN } from '../eth'

export default class AudiusToken {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  async balanceOf(account: Address): Promise<BigNumber> {
    await this.aud.hasPermissions()
    const value = (await read({
      ...contracts.audiusToken(),
      functionName: 'balanceOf',
      args: [asHex(account)]
    })) as bigint
    return toBN(value)
  }
}
