import { IconChevronDownOutline14 } from '../base/icons.js'
import styles from './ScrollJumpPad.module.css'

/** 滑动时浮现的上下箭头：到顶只剩向上、到底只剩向下，静止后自动淡出。 */
export const ScrollJumpPad = ({
  up,
  down,
  onUp,
  onDown,
  upLabel,
  downLabel,
}: {
  up: boolean
  down: boolean
  onUp: () => void
  onDown: () => void
  upLabel: string
  downLabel: string
}) => (
  <div className={styles.pad}>
    {up ? (
      <button type="button" className={styles.button} aria-label={upLabel} onClick={onUp}>
        <span className={styles.up}>
          <IconChevronDownOutline14 />
        </span>
      </button>
    ) : null}
    {down ? (
      <button type="button" className={styles.button} aria-label={downLabel} onClick={onDown}>
        <IconChevronDownOutline14 />
      </button>
    ) : null}
  </div>
)
