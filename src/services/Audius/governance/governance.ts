import BN from 'bn.js'
import {
  type Log,
  type Hex,
  encodeAbiParameters,
  hexToString,
  parseAbiParameters,
  stringToHex
} from 'viem'

import {
  GovernanceProposalEvent,
  GovernanceVoteEvent,
  GovernanceVoteUpdateEvent
} from 'models/TimelineEvents'
import {
  Vote,
  Outcome,
  Proposal,
  ProposalId,
  Address,
  VoteEvent,
  Permission,
  ProposalEvent
} from 'types'

import { AudiusClient } from '../AudiusClient'
import {
  asHex,
  contracts,
  getConnectedAccount,
  getEthPublicClient,
  read,
  simulate,
  toBN,
  writeAndWait
} from '../eth'

import { RawVoteEvent } from './types'

// Some governance event scans can return many logs; allow callers to bound the
// fromBlock window via env.
const QUERY_PROPOSAL_START_BLOCK = parseInt(
  import.meta.env.VITE_QUERY_PROPOSAL_START_BLOCK || '0'
)

type EventLog<TArgs> = Log & { args: TArgs }

export default class Governance {
  public aud: AudiusClient

  constructor(aud: AudiusClient) {
    this.aud = aud
  }

  /* -------------------- Governance Read -------------------- */

  async getProposalById(proposalId: ProposalId): Promise<Proposal> {
    await this.aud.hasPermissions()
    const raw = (await read({
      ...contracts.governance(),
      functionName: 'getProposalById',
      args: [BigInt(proposalId)]
    })) as readonly [
      bigint, // proposalId
      Address, // proposer
      bigint, // submissionBlockNumber
      Hex, // targetContractRegistryKey
      Address, // targetContractAddress
      bigint, // callValue
      string, // functionSignature
      Hex, // callData
      number, // outcome (uint8)
      bigint, // voteMagnitudeYes
      bigint, // voteMagnitudeNo
      bigint // numVotes
    ]
    return {
      proposalId: Number(raw[0]),
      proposer: raw[1],
      submissionBlockNumber: Number(raw[2]),
      targetContractRegistryKey: raw[3],
      targetContractAddress: raw[4],
      callValue: Number(raw[5]),
      functionSignature: raw[6],
      callData: raw[7],
      outcome: proposalOutcomeArr[raw[8]],
      voteMagnitudeYes: toBN(raw[9]),
      voteMagnitudeNo: toBN(raw[10]),
      numVotes: Number(raw[11]),
      // Consumers (see store/cache/proposals/hooks.ts) overwrite this with
      // the value from getProposalQuorum(); we initialize to zero so the
      // Proposal type's `quorum` invariant holds before that assignment.
      quorum: new BN(0)
    }
  }

  /**
   * Looks up the ProposalSubmitted event for a proposal and returns the
   * fields the legacy SDK exposed (name + description + blockNumber +
   * proposer). The legacy `queryStartBlock` arg is preserved for callers
   * but mapped onto viem's `fromBlock`.
   */
  async getProposalSubmissionById(
    proposalId: ProposalId,
    queryStartBlock = QUERY_PROPOSAL_START_BLOCK
  ): Promise<ProposalEvent> {
    await this.aud.hasPermissions()
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.governance(),
      eventName: 'ProposalSubmitted',
      args: { _proposalId: BigInt(proposalId) },
      fromBlock: BigInt(queryStartBlock)
    } as any)) as unknown as Array<
      EventLog<{
        _proposalId: bigint
        _proposer: Address
        _name: string
        _description: string
      }>
    >
    const event = events[0]
    return {
      proposalId: Number(event?.args?._proposalId ?? proposalId),
      proposer: event?.args?._proposer ?? '',
      submissionBlockNumber: Number(event?.blockNumber ?? 0),
      blockNumber: Number(event?.blockNumber ?? 0),
      name: event?.args?._name ?? '',
      description: event?.args?._description ?? ''
    }
  }

  /**
   * Looks up the ProposalOutcomeEvaluated event for a proposal and returns
   * the block it landed in. The legacy SDK returned the full Block object
   * via a follow-up eth.getBlock; we keep that here for shape parity.
   */
  async getProposalEvaluationBlock(
    proposalId: ProposalId,
    queryStartBlock = QUERY_PROPOSAL_START_BLOCK
  ) {
    await this.aud.hasPermissions()
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.governance(),
      eventName: 'ProposalOutcomeEvaluated',
      args: { _proposalId: BigInt(proposalId) },
      fromBlock: BigInt(queryStartBlock)
    } as any)) as unknown as Array<Log>
    const blockNumber = events[0]?.blockNumber
    if (blockNumber == null) return null
    return getEthPublicClient().getBlock({ blockNumber })
  }

  async getVotingQuorumPercent(): Promise<number> {
    await this.aud.hasPermissions()
    return Number(
      (await read({
        ...contracts.governance(),
        functionName: 'getVotingQuorumPercent'
      })) as bigint
    )
  }

  async getVotingPeriod(): Promise<number> {
    await this.aud.hasPermissions()
    return Number(
      (await read({
        ...contracts.governance(),
        functionName: 'getVotingPeriod'
      })) as bigint
    )
  }

  async getExecutionDelay(): Promise<number> {
    await this.aud.hasPermissions()
    return Number(
      (await read({
        ...contracts.governance(),
        functionName: 'getExecutionDelay'
      })) as bigint
    )
  }

  async getVoteByProposalAndVoter(
    proposalId: ProposalId,
    voterAddress: Address
  ): Promise<Vote | undefined> {
    await this.aud.hasPermissions()
    const info = (await read({
      ...contracts.governance(),
      functionName: 'getVoteInfoByProposalAndVoter',
      args: [BigInt(proposalId), asHex(voterAddress)]
    })) as readonly [number, bigint] // (vote, voteMagnitude)
    return formatVote(info[0] as 0 | 1 | 2)
  }

  async getVoteByProposalForOwner(
    proposalId: ProposalId
  ): Promise<Vote | undefined> {
    await this.aud.hasPermissions()
    const owner = getConnectedAccount()
    if (!owner) return undefined
    return this.getVoteByProposalAndVoter(proposalId, owner)
  }

  /** All vote submission events for the given proposal. */
  async getVotesForProposal(
    proposalId: ProposalId,
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<VoteEvent[]> {
    await this.aud.hasPermissions()
    return this.getVoteEvents(
      'ProposalVoteSubmitted',
      { _proposalId: BigInt(proposalId) },
      queryStartBlock
    )
  }

  /** All vote update events for the given proposal. */
  async getVoteUpdatesForProposal(
    proposalId: ProposalId,
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<VoteEvent[]> {
    await this.aud.hasPermissions()
    return this.getVoteEvents(
      'ProposalVoteUpdated',
      { _proposalId: BigInt(proposalId) },
      queryStartBlock
    )
  }

  /** All vote submissions by any of the given addresses. */
  async getVotesByAddress(
    addresses: Address[],
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<VoteEvent[]> {
    await this.aud.hasPermissions()
    return this.getVoteEvents(
      'ProposalVoteSubmitted',
      { _voter: addresses.map(asHex) },
      queryStartBlock
    )
  }

  async getVoteEventsByAddress(
    addresses: Address[],
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<GovernanceVoteEvent[]> {
    const votes = await this.getVotesByAddress(addresses, queryStartBlock)
    return votes.map((v) => ({ ...v, _type: 'GovernanceVote' }))
  }

  async getVoteUpdatesByAddress(
    addresses: Address[],
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<VoteEvent[]> {
    await this.aud.hasPermissions()
    return this.getVoteEvents(
      'ProposalVoteUpdated',
      { _voter: addresses.map(asHex) },
      queryStartBlock
    )
  }

  async getVoteUpdateEventsByAddress(
    addresses: Address[],
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<GovernanceVoteUpdateEvent[]> {
    const votes = await this.getVoteUpdatesByAddress(addresses, queryStartBlock)
    return votes.map((v) => ({ ...v, _type: 'GovernanceVoteUpdate' }))
  }

  /** All ProposalSubmitted events since `queryStartBlock`. */
  async getProposals(
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<ProposalEvent[]> {
    await this.aud.hasPermissions()
    return this.getProposalEvents(undefined, queryStartBlock)
  }

  /** In-progress proposal ids per on-chain `getInProgressProposals`. */
  async getInProgressProposalIds(): Promise<ProposalId[]> {
    await this.aud.hasPermissions()
    const ids = (await read({
      ...contracts.governance(),
      functionName: 'getInProgressProposals'
    })) as readonly bigint[]
    return ids.map((id) => Number(id))
  }

  /** ProposalSubmitted events filtered to the given proposer addresses. */
  async getProposalsForAddresses(
    addresses: Address[],
    queryStartBlock: number = QUERY_PROPOSAL_START_BLOCK
  ): Promise<GovernanceProposalEvent[]> {
    await this.aud.hasPermissions()
    const proposals = await this.getProposalEvents(
      { _proposer: addresses.map(asHex) },
      queryStartBlock
    )
    return proposals.map((p) => ({ ...p, _type: 'GovernanceProposal' }))
  }

  /**
   * Quorum is (total staked at submission block) * quorumPercent / 100. The
   * legacy SDK exposed `calculateQuorum(id)` as an on-chain helper; the modern
   * Governance ABI no longer ships it, so we compose from Staking +
   * Governance reads.
   */
  async getProposalQuorum(proposalId: number): Promise<BN> {
    await this.aud.hasPermissions()
    const proposal = await this.getProposalById(proposalId)
    const totalStakedAt = await this.aud.Staking.totalStakedAt(
      proposal.submissionBlockNumber
    )
    const quorumPct = await this.getVotingQuorumPercent()
    return totalStakedAt.mul(new BN(quorumPct)).div(new BN(100))
  }

  /* -------------------- Governance Write -------------------- */

  /**
   * Submit a proposal. The on-chain function returns the new proposalId,
   * which we capture via a pre-flight simulation so consumers get the legacy
   * return shape without parsing receipt logs.
   *
   * `callData` is accepted as either an array of raw argument values (the
   * legacy SDK's shape — it encoded internally based on functionSignature)
   * or a pre-encoded hex blob. When given an array we ABI-encode it here
   * using the parameter types parsed out of `functionSignature`.
   */
  async submitProposal(args: {
    targetContractName: string
    functionSignature: string
    callData: Hex | unknown[]
    name: string
    description: string
  }): Promise<ProposalId> {
    await this.aud.hasPermissions(Permission.WRITE)
    const owner = getConnectedAccount()
    if (!owner) throw new Error('No connected account')
    const registryKey = stringToHex(args.targetContractName, { size: 32 })
    const encodedCallData =
      typeof args.callData === 'string'
        ? args.callData
        : encodeCallData(args.functionSignature, args.callData)
    const proposalArgs = [
      registryKey,
      0n, // callValue: currently always 0
      args.functionSignature,
      encodedCallData,
      args.name,
      args.description
    ] as const

    const { result: idBig } = (await simulate({
      ...contracts.governance(),
      functionName: 'submitProposal',
      args: proposalArgs as unknown as readonly unknown[],
      account: owner as Hex
    })) as { result: bigint }
    await writeAndWait({
      ...contracts.governance(),
      functionName: 'submitProposal',
      args: proposalArgs as unknown as readonly unknown[]
    })
    return Number(idBig)
  }

  async submitVote({
    proposalId,
    vote
  }: {
    proposalId: ProposalId
    vote: Vote
  }): Promise<void> {
    await this.aud.hasPermissions(Permission.WRITE)
    await writeAndWait({
      ...contracts.governance(),
      functionName: 'submitVote',
      args: [BigInt(proposalId), createRawVote(vote)]
    })
  }

  async updateVote({
    proposalId,
    vote
  }: {
    proposalId: ProposalId
    vote: Vote
  }): Promise<void> {
    await this.aud.hasPermissions(Permission.WRITE)
    await writeAndWait({
      ...contracts.governance(),
      functionName: 'updateVote',
      args: [BigInt(proposalId), createRawVote(vote)]
    })
  }

  async evaluateProposalOutcome({
    proposalId
  }: {
    proposalId: ProposalId
  }): Promise<void> {
    await this.aud.hasPermissions(Permission.WRITE)
    await writeAndWait({
      ...contracts.governance(),
      functionName: 'evaluateProposalOutcome',
      args: [BigInt(proposalId)]
    })
  }

  /* -------------------- Internal event helpers -------------------- */

  private async getVoteEvents(
    eventName: 'ProposalVoteSubmitted' | 'ProposalVoteUpdated',
    args: Record<string, unknown>,
    fromBlock: number
  ): Promise<VoteEvent[]> {
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.governance(),
      eventName,
      args,
      fromBlock: BigInt(fromBlock)
    } as any)) as unknown as Array<
      EventLog<{
        _proposalId: bigint
        _voter: Address
        _vote: number
        _voterStake: bigint
      }>
    >
    const raw: RawVoteEvent[] = events.map((e) => ({
      proposalId: Number(e.args._proposalId),
      voter: e.args._voter,
      vote: (e.args._vote === 1 ? 1 : 2) as 1 | 2,
      voterStake: toBN(e.args._voterStake),
      blockNumber: Number(e.blockNumber)
    }))
    return raw.map(formatVoteEvent).filter(Boolean) as VoteEvent[]
  }

  private async getProposalEvents(
    args: Record<string, unknown> | undefined,
    fromBlock: number
  ): Promise<ProposalEvent[]> {
    const events = (await getEthPublicClient().getContractEvents({
      ...contracts.governance(),
      eventName: 'ProposalSubmitted',
      args,
      fromBlock: BigInt(fromBlock)
    } as any)) as unknown as Array<
      EventLog<{
        _proposalId: bigint
        _proposer: Address
        _name: string
        _description: string
      }>
    >
    return events.map((e) => ({
      proposalId: Number(e.args._proposalId),
      proposer: e.args._proposer,
      submissionBlockNumber: Number(e.blockNumber),
      blockNumber: Number(e.blockNumber),
      name: e.args._name,
      description: e.args._description
    }))
  }
}

/* -------------------- Formatting helpers -------------------- */

// Maps from index (proposal outcome raw value) to Outcome enum.
const proposalOutcomeArr: Outcome[] = [
  Outcome.InProgress,
  Outcome.Rejected,
  Outcome.ApprovedExecuted,
  Outcome.QuorumNotMet,
  Outcome.ApprovedExecutionFailed,
  Outcome.Evaluating,
  Outcome.Vetoed,
  Outcome.TargetContractAddressChanged,
  Outcome.TargetContractCodeHashChanged
]

const formatVote = (rawVote: 0 | 1 | 2): Vote | undefined => {
  if (rawVote === 0) return undefined
  const voteMap = { 1: Vote.No, 2: Vote.Yes }
  return voteMap[rawVote]
}

const formatVoteEvent = (voteEvent: RawVoteEvent): VoteEvent | undefined => {
  const vote = formatVote(voteEvent.vote)
  if (!vote) return undefined
  return { ...voteEvent, vote }
}

const createRawVote = (vote: Vote): 1 | 2 => {
  const voteMap = { [Vote.No]: 1, [Vote.Yes]: 2 } as {
    [vote: string]: 1 | 2
  }
  return voteMap[vote]
}

// Re-exported for legacy callers that pull from helpers.ts via this module.
export { hexToString }

/**
 * ABI-encode an array of arg values against the parameter types parsed out
 * of a Solidity-style function signature. e.g. signature `slash(uint256,
 * address)` + values `[100n, '0xabc...']` -> the 64-byte hex blob the
 * Governance contract expects as `_callData`.
 */
function encodeCallData(functionSignature: string, values: unknown[]): Hex {
  const inside = functionSignature.split('(')[1]?.split(')')[0] ?? ''
  if (!inside.trim()) return '0x' as Hex
  return encodeAbiParameters(parseAbiParameters(inside), values as any)
}
