import { hexToString, stringToHex, type Hex } from 'viem'

import { ServiceType, Version, BigNumber } from 'types'

import { AudiusClient } from './AudiusClient'
import { contracts, read, toBN } from './eth'

export type GetValidServiceTypesResponse = Array<ServiceType>
export type GetServiceTypeInfoResponse = {
  isValid: boolean
  minStake: BigNumber
  maxStake: BigNumber
}

/** bytes32-encode a service type string for on-chain calls. */
const encodeServiceType = (serviceType: ServiceType): Hex =>
  stringToHex(serviceType, { size: 32 })

/** Decode a bytes32 service type back to its string form (e.g. "validator"). */
const decodeServiceType = (value: Hex): ServiceType =>
  hexToString(value, { size: 32 }) as ServiceType

/** Decode a bytes32 version (ASCII bytes, right-padded) to a string. */
const decodeVersion = (value: Hex): Version =>
  hexToString(value, { size: 32 })

export default class NodeType {
  aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Service Type Manager Client Read -------------------- */

  async getValidServiceTypes(): Promise<GetValidServiceTypesResponse> {
    await this.aud.hasPermissions()
    const serviceTypes = (await read({
      ...contracts.serviceTypeManager(),
      functionName: 'getValidServiceTypes'
    })) as readonly Hex[]
    return serviceTypes.map(decodeServiceType)
  }

  async getCurrentVersion(serviceType: ServiceType): Promise<Version> {
    await this.aud.hasPermissions()
    const version = (await read({
      ...contracts.serviceTypeManager(),
      functionName: 'getCurrentVersion',
      args: [encodeServiceType(serviceType)]
    })) as Hex
    return decodeVersion(version)
  }

  async getVersion(
    serviceType: ServiceType,
    versionIndex: number
  ): Promise<Version> {
    await this.aud.hasPermissions()
    const version = (await read({
      ...contracts.serviceTypeManager(),
      functionName: 'getVersion',
      args: [encodeServiceType(serviceType), BigInt(versionIndex)]
    })) as Hex
    return decodeVersion(version)
  }

  async getNumberOfVersions(serviceType: ServiceType): Promise<number> {
    await this.aud.hasPermissions()
    const numberOfVersions = (await read({
      ...contracts.serviceTypeManager(),
      functionName: 'getNumberOfVersions',
      args: [encodeServiceType(serviceType)]
    })) as bigint
    return Number(numberOfVersions)
  }

  async getServiceTypeInfo(
    serviceType: ServiceType
  ): Promise<GetServiceTypeInfoResponse> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.serviceTypeManager(),
      functionName: 'getServiceTypeInfo',
      args: [encodeServiceType(serviceType)]
    })) as readonly [boolean, bigint, bigint]
    return {
      isValid: info[0],
      minStake: toBN(info[1]),
      maxStake: toBN(info[2])
    }
  }
}
