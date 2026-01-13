import { useEffect, useState } from 'react'

import { Box, Flex, Text } from '@audius/harmony'

import Button, { ButtonType } from 'components/Button'
import { Card } from 'components/Card/Card'
import Loading from 'components/Loading'
import { LoadingSpinner } from 'components/LoadingSpinner/LoadingSpinner'
import { useAccount } from 'store/account/hooks'
import { useClaimMetadata } from 'store/cache/claims/hooks'
import { useEthBlockNumber, useTimeRemaining } from 'store/cache/protocol/hooks'
import { Status } from 'types'
import { formatNumber, getHumanReadableTime } from 'utils/format'

import styles from './RewardsTimingCard.module.css'

const messages = {
  rewardsTiming: 'Rewards Timing',
  currentRound: 'Current Round',
  untilNextRound: 'Until Next Round is Available',
  blocksRemaining: 'Blocks Remaining',
  startNextRound: 'Start Next Round'
}

export const RewardsTimingCard = () => {
  const currentBlockNumber = useEthBlockNumber()
  const { status, claimMetadata } = useClaimMetadata()
  const [currentRound, setCurrentRound] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const getCurrentRound = async () => {
    await window.aud.awaitSetup()
    const round = await window.aud.Claim.getCurrentRound()
    setCurrentRound(round)
  }
  useEffect(() => {
    getCurrentRound()
  }, [])

  const { isLoggedIn } = useAccount()

  const period =
    status === Status.Success
      ? claimMetadata.lastFundedBlock +
        claimMetadata.fundingRoundBlockDiff -
        currentBlockNumber
      : null

  const canInitiateRound =
    status === Status.Success
      ? currentBlockNumber - claimMetadata.lastFundedBlock >
          claimMetadata.fundingRoundBlockDiff &&
        !!window.aud?.Claim?.initiateRound
      : false
  const { timeRemaining } = useTimeRemaining(currentBlockNumber, period)

  const handleClickInitiateRound = async () => {
    setIsSubmitting(true)
    try {
      await window.aud?.Claim?.initiateRound()
    } catch (e) {
      console.error(e)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card direction='column' css={{ backgroundColor: '#000000' }}>
      <Box pv='xl' ph='xl' css={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <Text variant='heading' size='s'>
          {messages.rewardsTiming}
        </Text>
      </Box>
      <Flex p='l' gap='xl' wrap='wrap'>
        <Card p='xl' direction='column' css={{ backgroundColor: '#000000' }}>
          <Box>
            {currentBlockNumber == null ? (
              <Box mb='xs'>
                <Loading className={styles.loading} />
              </Box>
            ) : (
              <Text variant='heading' size='s' strength='default'>
                {currentRound}
              </Text>
            )}
          </Box>
          <Box>
            <Text variant='body' size='m' style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
              {messages.currentRound}
            </Text>
          </Box>
        </Card>
        <Card
          p='xl'
          css={{ flexGrow: 1, backgroundColor: '#000000' }}
          justifyContent='space-between'
          wrap='wrap'
          gap='l'
        >
          <Flex gap='xl' wrap='wrap'>
            <Box>
              {timeRemaining == null ? (
                <Box mb='xs'>
                  <Loading className={styles.loading} />
                </Box>
              ) : (
                <Text variant='heading' size='s' strength='default'>
                  {getHumanReadableTime(timeRemaining)}
                </Text>
              )}
              <Text variant='body' size='m' style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                {messages.untilNextRound}
              </Text>
            </Box>
            <Box>
              {period == null ? (
                <Box mb='xs'>
                  <Loading className={styles.loading} />
                </Box>
              ) : (
                <Text variant='heading' size='s' strength='default'>
                  {formatNumber(period)}
                </Text>
              )}
              <Text variant='body' size='m' style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                {messages.blocksRemaining}
              </Text>
            </Box>
          </Flex>
          {isLoggedIn ? (
            <Button
              type={canInitiateRound ? ButtonType.PRIMARY : ButtonType.DISABLED}
              text={messages.startNextRound}
              rightIcon={isSubmitting ? <LoadingSpinner /> : undefined}
              isDisabled={!canInitiateRound || isSubmitting}
              onClick={handleClickInitiateRound}
              className="gradient-button startNextRoundButton"
            />
          ) : null}
        </Card>
      </Flex>
    </Card>
  )
}
