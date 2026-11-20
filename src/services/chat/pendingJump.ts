import { create } from 'zustand'

/** 搜索结果跳到某条消息：会话页渲染后按它定位一次，用完即清。 */
type JumpTarget = { sessionId: string; messageId: string; seq: number }

type JumpState = { target: JumpTarget | null }

export const useMessageJump = create<JumpState>(() => ({ target: null }))

let seq = 0

export const requestMessageJump = (sessionId: string, messageId: string) => {
  seq += 1
  useMessageJump.setState({ target: { sessionId, messageId, seq } })
}

export const clearMessageJump = () => useMessageJump.setState({ target: null })
