import { Keyboard } from '@capacitor/keyboard'
import { create } from 'zustand'

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭 */
export const useMobileSider = create(() => ({ open: false }))

/** 收起软键盘：抽屉滑出时键盘不该继续压着屏幕下半截（浏览器里无实现，吞掉报错即可） */
export const hideSoftKeyboard = () => {
  void Keyboard.hide().catch(() => {})
}

export const openMobileSider = () => {
  hideSoftKeyboard()
  useMobileSider.setState({ open: true })
}

export const closeMobileSider = () => useMobileSider.setState({ open: false })
