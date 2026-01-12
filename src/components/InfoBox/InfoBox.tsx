import { Box, Flex, IconQuestionCircle, Text } from '@audius/harmony'

import { Card } from 'components/Card/Card'
import { PlainLink } from 'components/PlainLink/PlainLink'

type InfoBoxProps = {
  description: string
  ctaText: string
  ctaHref: string
  fullWidth?: boolean
}

export const InfoBox = ({
  description,
  ctaText,
  ctaHref,
  fullWidth
}: InfoBoxProps) => {
  return (
    <Card
      backgroundColor='staticBlack'
      pv='m'
      ph='l'
      gap='l'
      w={fullWidth ? '100%' : undefined}
      css={{
        backgroundColor: '#1a1a1a'
      }}
    >
      <Box>
        <IconQuestionCircle 
          size='2xl' 
          color='inverse'
          css={{
            '& svg': {
              color: '#ffffff !important',
              fill: '#ffffff !important'
            },
            '& path': {
              fill: '#ffffff !important'
            }
          }}
        />
      </Box>
      <Flex direction='column' gap='m'>
        <Text variant='body' size='m' strength='default' style={{ color: 'rgba(255, 255, 255, 0.9)' }}>
          {description}
        </Text>
        <PlainLink href={ctaHref}>{ctaText}</PlainLink>
      </Flex>
    </Card>
  )
}
