import React from 'react'
import OAPLogoIcon from 'assets/img/oap-logo.svg'
import clsx from 'clsx'

interface OAPLogoProps {
  className?: string
  color?: string
}

const OAPLogo: React.FC<OAPLogoProps> = ({ className, color }) => {
  return (
    <OAPLogoIcon
      className={clsx(className)}
      style={{ 
        color: color || 'currentColor',
        fill: color || 'currentColor',
        width: '40px',
        height: 'auto'
      }}
    />
  )
}

export default OAPLogo

