import { useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { closeTopModal } from '../components/base/Modal.js'
import { showToast } from '../components/base/toastState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'

/** 两次返回键间隔小于此值才退出，避免误触直接回桌面 */
const EXIT_INTERVAL = 2500

/**
 * Android 系统返回键分级处理：先收键盘 → 关最上层弹窗 → 关抽屉 → 关搜索面板，
 * 都在主界面时连续按两次才退出。非原生平台不注册。
 */
export const useAndroidBackButton = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return
    }
    let lastBack = 0
    let disposed = false
    void CapacitorApp.addListener('backButton', () => {
      if (disposed) {
        return
      }
      // 1) 有输入法或焦点在文本框时，先让键盘/焦点退出，不往下传播
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        active.blur()
        return
      }
      // 2) 最上层弹窗（设置、删除/导入确认等）
      if (closeTopModal()) {
        return
      }
      // 3) 移动端聊天历史抽屉
      if (useMobileSider.getState().open) {
        closeMobileSider()
        return
      }
      // 4) 搜索结果面板
      if (useSearchPanel.getState().entry !== null) {
        closeSearchPanel()
        return
      }
      // 5) 主界面：二次确认才退出
      const now = Date.now()
      if (now - lastBack < EXIT_INTERVAL) {
        void CapacitorApp.exitApp()
      } else {
        lastBack = now
        showToast({ key: 'backExitHint' })
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove()
      }
    })
    return () => {
      disposed = true
    }
  }, [])
}
