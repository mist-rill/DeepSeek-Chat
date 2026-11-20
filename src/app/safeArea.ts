import { Capacitor } from '@capacitor/core'

/** MainActivity 注入的系统栏高度与屏幕圆角半径，单位是物理像素 */
type AndroidInsets = {
  top: () => number
  bottom: () => number
  cornerRadius?: () => number
}

const readInset = (read: () => number) => {
  try {
    const value = read()
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/**
 * 安卓内容铺满整屏后，WebView 拿不到可靠的 env(safe-area-inset-*)，
 * 由原生把系统栏高度直接交给这里，换算成 CSS 像素写进 --safe-top / --safe-bottom。
 * 顶栏、抽屉、输入区都只读这两个变量，控件整体下移，状态栏区域留给页面背景。
 */
export const setupSafeArea = () => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return
  }
  const bridge = (window as Window & { AndroidInsets?: AndroidInsets }).AndroidInsets
  if (!bridge) {
    return
  }
  const root = document.documentElement
  const sync = () => {
    const ratio = window.devicePixelRatio || 1
    root.style.setProperty('--safe-top', `${readInset(() => bridge.top()) / ratio}px`)
    root.style.setProperty('--safe-bottom', `${readInset(() => bridge.bottom()) / ratio}px`)
    // 屏幕圆角：聊天卡片贴合手机边框的弧度跟系统一致（拿不到时不写，CSS 走 38px 兜底）
    const cornerRadius = bridge.cornerRadius
    if (cornerRadius) {
      const radius = readInset(() => cornerRadius())
      if (radius > 0) {
        root.style.setProperty('--screen-radius', `${radius / ratio}px`)
      }
    }
  }
  sync()
  // 首帧布局、旋转、状态栏显隐后系统栏高度可能才稳定下来
  window.addEventListener('resize', sync)
  window.addEventListener('orientationchange', sync)
  window.setTimeout(sync, 300)
  window.setTimeout(sync, 1200)
}
