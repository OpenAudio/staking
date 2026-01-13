import clsx from 'clsx'

import Button, { ButtonType } from 'components/Button'
import RegisterServiceModal from 'components/RegisterServiceModal'
import { useModalControls } from 'utils/hooks'

import styles from './ManageService.module.css'
import buttonStyles from './RegisterNewServiceBtn.module.css'

const messages = {
  register: 'Register New Node'
}

type RegisterNewServiceBtnProps = {
  customText?: string
}
export const RegisterNewServiceBtn = ({
  customText
}: RegisterNewServiceBtnProps) => {
  const { isOpen, onClick, onClose } = useModalControls()
  return (
    <>
      <Button
        onClick={onClick}
        type={ButtonType.PRIMARY}
        text={customText || messages.register}
        className="gradient-button registerButton"
        textClassName={styles.registerBtnText}
      />
      <RegisterServiceModal isOpen={isOpen} onClose={onClose} />
    </>
  )
}
