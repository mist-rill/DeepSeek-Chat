import { Capacitor, registerPlugin } from '@capacitor/core'

/** 原生音效通道：tap 点击 / swipe 滑动 / boot 打开 / home 离开 */
export type CuteSoundName = 'tap' | 'swipe' | 'boot' | 'home'

interface CuteSoundPlugin {
  play(options: { name: CuteSoundName; volume?: number }): Promise<void>
}

const CuteSound = registerPlugin<CuteSoundPlugin>('CuteSound')

/** 只在原生端发声；浏览器里没有这个插件，直接静默跳过 */
export const isCuteSoundAvailable = () => Capacitor.isNativePlatform()

export const playCuteSound = (name: CuteSoundName, volume = 0.6) => {
  if (!Capacitor.isNativePlatform()) {return}
  void CuteSound.play({ name, volume }).catch(() => {
    /* 插件不可用时不要影响交互 */
  })
}

// ------------------------------------------------------------ 全局点击 / 滑动

/** 两次点击音的最小间隔，避免同一次触摸被拆成多帧重复播放 */
const TAP_MIN_GAP = 120
/** 滑动音的节流间隔 */
const SWIPE_MIN_GAP = 280
/** 位移超过这个距离才算滑动（过滤手指轻微抖动） */
const SWIPE_TRIGGER_DISTANCE = 18
/** 一次手势里最多响几声，防止长距离滚动刷屏 */
const SWIPE_MAX_PER_GESTURE = 2

const VOLUME = { tap: 0.55, swipe: 0.4 }

export const installCuteSoundListeners = () => {
  if (!Capacitor.isNativePlatform()) {return () => {}}

  let lastTapAt = 0
  let lastSwipeAt = 0
  let startX = 0
  let startY = 0
  let swipeCount = 0
  let tracking = false

  const onPointerDown = (event: PointerEvent) => {
    if (event.isPrimary === false) {return}
    if (event.button !== 0 && event.pointerType === 'mouse') {return}
    const now = Date.now()
    if (now - lastTapAt < TAP_MIN_GAP) {return}
    lastTapAt = now
    playCuteSound('tap', VOLUME.tap)
  }

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) {return}
    startX = touch.clientX
    startY = touch.clientY
    swipeCount = 0
    tracking = true
  }

  const onTouchMove = (event: TouchEvent) => {
    if (!tracking || swipeCount >= SWIPE_MAX_PER_GESTURE) {return}
    const touch = event.touches[0]
    if (!touch) {return}
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    if (Math.hypot(dx, dy) < SWIPE_TRIGGER_DISTANCE) {return}
    const now = Date.now()
    if (now - lastSwipeAt < SWIPE_MIN_GAP) {return}
    lastSwipeAt = now
    swipeCount += 1
    // 响过之后把起点前移，避免一次长滑被当成连续触发
    startX = touch.clientX
    startY = touch.clientY
    playCuteSound('swipe', VOLUME.swipe)
  }

  const onTouchEnd = () => {
    tracking = false
    swipeCount = 0
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
  window.addEventListener('touchend', onTouchEnd, true)
  window.addEventListener('touchcancel', onTouchEnd, true)

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('touchstart', onTouchStart, true)
    window.removeEventListener('touchmove', onTouchMove, true)
    window.removeEventListener('touchend', onTouchEnd, true)
    window.removeEventListener('touchcancel', onTouchEnd, true)
  }
}
