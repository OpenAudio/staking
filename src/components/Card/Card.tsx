import { Flex, FlexProps } from '@audius/harmony'
import clsx from 'clsx'

import styles from './Card.module.css'

export const Card = (props: FlexProps) => {
  const { className, ...restProps } = props
  return (
    <Flex
      backgroundColor='staticBlack'
      borderRadius='l'
      className={clsx(styles.card, className)}
      {...restProps}
    />
  )
}
