import { useSettings, type FontScale, type FontWeight } from '../services/settings.js'

/** 滑块范围：比官方稍窄，保证极端字号下输入框和表格还能排下 */
export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.3
export const FONT_SCALE_STEP = 0.05

/** 字重滑块范围：400 标准，往上加粗，步进 50 */
export const FONT_WEIGHT_MIN = 400
export const FONT_WEIGHT_MAX = 600
export const FONT_WEIGHT_STEP = 50

type AndroidFontBridge = { fontScale?: () => number }

const clamp = (value: number) =>
  Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(value * 100) / 100))

/**
 * 安卓系统字号比例（设置 → 显示 → 字体大小）。
 * WebView 不会跟着系统字号走，所以由 MainActivity 把这个值直接交过来；
 * 浏览器、桌面端拿不到接口，按标准字号处理。
 */
const systemFontScale = () => {
  const bridge = (window as Window & { AndroidInsets?: AndroidFontBridge }).AndroidInsets
  try {
    const value = Number(bridge?.fontScale?.() ?? 1)
    return Number.isFinite(value) && value > 0 ? clamp(value) : 1
  } catch {
    return 1
  }
}

/** 设置里存的是偏好，真正生效的字号比例要先把「跟随系统」换算出来 */
export const resolveFontScale = (preference: FontScale) =>
  preference === 'system' ? systemFontScale() : clamp(preference)

/**
 * 字重偏移换算成四个档位变量：正文 400、中等 500、强调 600、标题 700，
 * 各自加上同一个偏移量（标题封顶 900，避免超出合法范围）。
 * theme.css 里的字体 token 引用这些变量，JS 算好直接给数值，不走 calc。
 */
const applyWeight = (weight: FontWeight) => {
  const delta = Math.min(200, Math.max(0, weight - 400))
  const style = document.documentElement.style
  style.setProperty('--fs-weight-body', String(400 + delta))
  style.setProperty('--fs-weight-mid', String(500 + delta))
  style.setProperty('--fs-weight-strong', String(Math.min(900, 600 + delta)))
  style.setProperty('--fs-weight-head', String(Math.min(900, 700 + delta)))
}

/** 全文正文字号由 --fs-scale 缩放、粗细由 --fs-weight-* 档位控制，改这几个变量就够了 */
const apply = (state: { fontScale: FontScale; fontWeight: FontWeight }) => {
  document.documentElement.style.setProperty('--fs-scale', String(resolveFontScale(state.fontScale)))
  applyWeight(state.fontWeight)
}

/** 启动时应用一次，之后设置里每改一次就跟着变（含跟随系统时的滑块禁用状态） */
export const setupFontScale = () => {
  apply(useSettings.getState())
  useSettings.subscribe((state) => apply(state))
  // 旋转屏幕、从系统设置返回时重新读一次系统字号
  window.addEventListener('resize', () => apply(useSettings.getState()))
}
