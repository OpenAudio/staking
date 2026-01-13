import { Box, Flex, Text } from '@audius/harmony'

import Button, { ButtonType } from 'components/Button'
import { Card } from 'components/Card/Card'
import { ConnectAudiusProfileModal } from 'components/ConnectAudiusProfileModal/ConnectAudiusProfileModal'
import { useDashboardWalletUser } from 'hooks/useDashboardWalletUsers'
import { useAccountUser } from 'store/account/hooks'
import { useModalControls } from 'utils/hooks'

import styles from './ConnectAudiusProfileCard.module.css'

const messages = {
  connectAudiusProfile: 'Connect Audius Profile',
  connectAudius: 'Connect Audius',
  connectAudiusProfileDescription:
    'Help other users identify you by connecting your Audius account.',
  unlinkAudiusProfile: 'Unlink',
  audiusProfile: 'Audius Profile'
}

type ConnectAudiusProtileBtnProps = {
  wallet: string
}
const ConnectAudiusProfileButton = ({
  wallet
}: ConnectAudiusProtileBtnProps) => {
  const { isOpen, onClick, onClose } = useModalControls()
  return (
    <>
      <Button
        onClick={onClick}
        type={ButtonType.PRIMARY}
        text={messages.connectAudius}
        className="gradient-button connectButton"
      />
      <ConnectAudiusProfileModal
        wallet={wallet}
        isOpen={isOpen}
        onClose={onClose}
        action='connect'
      />
    </>
  )
}

export const ConnectAudiusProfileCard = () => {
  const { user: accountUser } = useAccountUser()
  const { data: audiusProfileData, status: audiusProfileDataStatus } =
    useDashboardWalletUser(accountUser?.wallet)

  const hasConnectedAudiusAccount = audiusProfileData != null

  if (
    !accountUser?.wallet ||
    audiusProfileDataStatus !== 'success' ||
    hasConnectedAudiusAccount
  ) {
    return null
  }

  return (
    <Card gap='xl' pv='l' ph='xl' css={{ backgroundColor: '#000000' }}>
      <Flex direction='column' gap='s' css={{ flexGrow: 1 }}>
        <Text variant='heading' size='s'>
          {messages.connectAudiusProfile}
        </Text>
        <Text variant='body' size='m' strength='strong' style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
          {messages.connectAudiusProfileDescription}
        </Text>
      </Flex>
      <Box>
        <ConnectAudiusProfileButton wallet={accountUser.wallet} />
      </Box>
    </Card>
  )
}
