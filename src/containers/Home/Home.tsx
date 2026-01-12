import {
  Box,
  Flex,
  Text
} from '@audius/harmony'

import IconHouse from 'assets/img/iconHouse.svg'
import { Card } from 'components/Card/Card'
import EstimatedAnnualStat from 'components/EstimatedAnnualStat'
import EstimatedWeeklyStat from 'components/EstimatedWeeklyStat'
import {
  EstimatedRewardRateInfoTooltip,
  GlobalStakedInfoTooltip
} from 'components/InfoTooltip/InfoTooltips'
import Loading from 'components/Loading'
import { ManageAccountCard } from 'components/ManageAccountCard/ManageAccountCard'
import Page from 'components/Page'
import Paper from 'components/Paper'
import Proposal from 'components/Proposal'
import { NoProposals } from 'components/Proposals'
import { RewardsTimingCard } from 'components/RewardsTimingCard/RewardsTimingCard'
import { StatLabel } from 'components/StatLabel/StatLabel'
import TopAddressesTable from 'components/TopAddressesTable'
import TotalStakedStat from 'components/TotalStakedStat'
import TransactionStatus from 'components/TransactionStatus'
import { useAccount } from 'store/account/hooks'
import {
  useActiveProposals,
  useRecentProposals
} from 'store/cache/proposals/hooks'
import { TICKER } from 'utils/consts'
import { usePushRoute } from 'utils/effects'
import { createStyles, isMobile } from 'utils/mobile'
import {
  GOVERNANCE
} from 'utils/routes'

import desktopStyles from './Home.module.css'
import mobileStyles from './HomeMobile.module.css'

const styles = createStyles({ desktopStyles, mobileStyles })

const messages = {
  title: 'Overview',
  globalStakedAudio: `Global Staked ${TICKER}`,
  estimatedRewardRate: `Estimated ${TICKER} Reward Rate`,
  recentProposals: 'Recent Proposals',
  noProposals: 'No Recent Proposals',
  viewAllProposals: 'View All Proposals'
}

const Home = () => {
  const { isLoggedIn, wallet } = useAccount()
  const { recentProposals } = useRecentProposals()
  const { activeProposals } = useActiveProposals()
  const pushRoute = usePushRoute()
  const mobile = isMobile()

  const proposalsToShow =
    activeProposals && recentProposals
      ? activeProposals && activeProposals.length < 5
        ? activeProposals.concat(
            recentProposals.slice(0, 5 - activeProposals.length) || []
          )
        : activeProposals
      : null

  return (
    <Page icon={IconHouse} title={messages.title}>
      <Flex direction='column' gap='l'>
        <Card direction='column' gap='xl' p='xl' css={{ backgroundColor: '#000000' }}>
          <Flex
            w='100%'
            direction='column'
            alignItems='center'
            justifyContent='center'
          >
            <TotalStakedStat
              color='heading'
              variant='display'
              strength='strong'
              size={mobile ? 's' : 'l'}
            />
            <Flex inline gap='xs' alignItems='center'>
              <StatLabel
                variant='heading'
                strength='default'
                size={mobile ? 'm' : 's'}
              >
                {messages.globalStakedAudio}
              </StatLabel>
              <GlobalStakedInfoTooltip />
            </Flex>
          </Flex>
        </Card>
        <Card
          pv='l'
          ph='xl'
          css={{ backgroundColor: '#000000' }}
          justifyContent={mobile ? 'space-between' : 'space-around'}
          alignItems='center'
          wrap='wrap'
        >
          <Box mb={mobile ? 'm' : undefined}>
            <Flex inline gap='xs' alignItems='center'>
              <Text
                variant='heading'
                size='s'
                strength='default'
                style={{ color: 'rgba(255, 255, 255, 0.8)' }}
              >
                {messages.estimatedRewardRate}
              </Text>
              <EstimatedRewardRateInfoTooltip color='subdued' />
            </Flex>
          </Box>
          <EstimatedWeeklyStat />
          <EstimatedAnnualStat />
        </Card>
        {isLoggedIn && wallet ? (
          <>
            <TransactionStatus />
            <ManageAccountCard wallet={wallet} />
          </>
        ) : null}
        <RewardsTimingCard />
        <Paper className={styles.proposals}>
          <Box p='xl'>
            <Text variant='heading' size='s' strength='default' tag='span'>
              {messages.recentProposals}
            </Text>
          </Box>
          <div className={styles.list}>
            {proposalsToShow ? (
              proposalsToShow.length > 0 ? (
                proposalsToShow.map((proposal, i) => (
                  <Proposal key={i} proposal={proposal} />
                ))
              ) : (
                <NoProposals text={messages.noProposals} />
              )
            ) : (
              <Loading className={styles.loading} />
            )}
          </div>
          <div
            onClick={() => pushRoute(GOVERNANCE)}
            className={styles.moreText}
          >
            {messages.viewAllProposals}
          </div>
        </Paper>
        <TopAddressesTable limit={5} alwaysShowMore />
      </Flex>
    </Page>
  )
}

export default Home
