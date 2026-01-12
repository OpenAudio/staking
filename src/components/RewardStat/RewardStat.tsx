import React, { ReactNode } from 'react'

import { Flex, Text } from '@audius/harmony'

import Error from 'components/Error'
import Loading from 'components/Loading'

import styles from './RewardStat.module.css'

type OwnProps = {
  className?: string
  stat: ReactNode
  label: string
  error?: boolean
}

type RewardStatProps = OwnProps

const RewardStat: React.FC<RewardStatProps> = ({ stat, label, error }) => {
  return (
    <Flex gap='s'>
      {error ? (
        <div className={styles.stat}>
          <Error />
        </div>
      ) : stat !== null ? (
        <Text
          css={{ display: 'inline' }}
          variant='heading'
          size='s'
          strength='default'
          tag='span'
        >
          {stat}
        </Text>
      ) : (
        <div className={styles.loadingContainer}>
          <Loading className={styles.loading} />
        </div>
      )}
      <Text
        css={{ display: 'inline' }}
        variant='heading'
        size='s'
        strength='default'
        tag='span'
        style={{ color: 'rgba(255, 255, 255, 0.8)' }}
      >
        {label}
      </Text>
    </Flex>
  )
}

export default RewardStat
