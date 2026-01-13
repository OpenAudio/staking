import { useCallback } from 'react'

import { Button, ButtonType, IconRemove } from '@audius/stems'
import clsx from 'clsx'
import { matchPath, useNavigate, useLocation } from 'react-router'

import { navRoutes } from 'utils/routes'

import styles from './MobileNav.module.css'

const messages = {
  name: 'Open Audio Protocol Staking'
}

const MobileNavButton = ({
  baseRoute,
  matchParams,
  text,
  pushRoute,
  onClose
}) => {
  const location = useLocation()

  const isActiveRoute = matchParams.some(
    (matchParam) => !!matchPath(matchParam, location.pathname)
  )
  const onButtonClick = useCallback(() => {
    onClose()
    pushRoute(baseRoute)
  }, [baseRoute, pushRoute, onClose])

  return (
    <Button
      text={text}
      type={ButtonType.GLASS}
      className={clsx(styles.navButton, { [styles.active]: isActiveRoute })}
      textClassName={clsx(styles.navButtonText)}
      onClick={onButtonClick}
    />
  )
}

type MobileNavProps = {
  isOpen: boolean
  onClose: () => void
}

const MobileNav = ({ isOpen, onClose }: MobileNavProps) => {
  const navigate = useNavigate()

  return (
    <div
      className={clsx(styles.container, {
        [styles.isOpen]: isOpen
      })}
    >
      <div className={styles.close} onClick={onClose}>
        <IconRemove />
      </div>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.name}>{messages.name}</div>
        </div>
        {navRoutes.map((route) => (
          <div key={route.text} className={styles.btnContainer}>
            <MobileNavButton
              {...route}
              onClose={onClose}
              pushRoute={(path) => navigate(path)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default MobileNav
