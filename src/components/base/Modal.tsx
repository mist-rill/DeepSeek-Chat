import clsx from 'clsx'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './Modal.module.css'

/** 当前打开的弹窗，后打开的在末尾；叠放时 Esc / 系统返回键只关闭最上层 */
const openModals: {
  token: object
  onClose: () => void
  /** 返回键的第一处理权：返回 true 表示自己消化了这次返回（例如从二级页退回首页） */
  onBack: () => boolean
}[] = []

/** 关闭最上层弹窗（供 Android 系统返回键调用）；无弹窗时返回 false */
export const closeTopModal = (): boolean => {
  const top = openModals.at(-1)
  if (!top) {
    return false
  }
  if (top.onBack()) {
    return true
  }
  top.onClose()
  return true
}

/** 遮罩 + 居中卡片，Esc / 点遮罩关闭 */
export const Modal = ({
  title,
  children,
  footer,
  closable = false,
  leading,
  centerTitle = false,
  className,
  mainClassName,
  onClose,
  onBack,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** 标题栏右侧显示关闭按钮 */
  closable?: boolean
  /** 标题栏左侧的自定义元素，传入后标题居中（移动端二级页面放返回按钮） */
  leading?: ReactNode
  /** 标题居中显示（移动端整页模式的首页） */
  centerTitle?: boolean
  className?: string
  /** 内容区的 class */
  mainClassName?: string
  /**
   * 系统返回键 / Esc 的第一处理权。返回 true 表示这次返回已经在弹窗内部消化掉，
   * 弹窗保持打开；不传或返回 false 才会关闭弹窗。
   */
  onBack?: () => boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useEffect(() => {
    const token = {}
    openModals.push({
      token,
      onClose: () => onCloseRef.current(),
      onBack: () => onBackRef.current?.() ?? false,
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModals.at(-1)?.token === token) {
        if (onBackRef.current?.()) {
          return
        }
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      const index = openModals.findIndex((entry) => entry.token === token)
      if (index !== -1) {
        openModals.splice(index, 1)
      }
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={clsx(styles.content, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className={clsx(
            styles.header,
            (leading !== undefined || centerTitle) && styles.headerWithLeading
          )}
        >
          {leading === undefined ? null : <div className={styles.leading}>{leading}</div>}
          <div id={titleId} className={styles.title}>
            {title}
          </div>
          {closable ? (
            <IconButton
              className={styles.close}
              tone="primary"
              icon={<IconCloseOutline16 />}
              aria-label={t('close')}
              onClick={onClose}
            />
          ) : null}
        </div>
        {children ? <div className={clsx(styles.main, mainClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
