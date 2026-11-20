import { create } from 'zustand'

/** 置顶会话只存 id 列表，独立于会话数据，导入 / 删除会话都不影响其余置顶项。 */
const STORAGE_KEY = 'chat-demo:pinned-sessions'

const read = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const write = (ids: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // 存储不可用时只在本次会话内生效
  }
}

type PinnedState = { ids: string[] }

export const usePinnedSessions = create<PinnedState>(() => ({ ids: read() }))

export const isPinned = (id: string) => usePinnedSessions.getState().ids.includes(id)

/** 置顶 / 取消置顶；置顶项排在列表最前，同一批内仍按更新时间降序。 */
export const togglePin = (id: string) => {
  const ids = usePinnedSessions.getState().ids
  const next = ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids]
  write(next)
  usePinnedSessions.setState({ ids: next })
}

/** 删除会话时一并清掉置顶标记，避免重名 id 复用时误置顶。 */
export const forgetPin = (id: string) => {
  const ids = usePinnedSessions.getState().ids
  if (!ids.includes(id)) {
    return
  }
  const next = ids.filter((item) => item !== id)
  write(next)
  usePinnedSessions.setState({ ids: next })
}
