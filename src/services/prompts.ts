import { create } from 'zustand'
import { createId } from '../utils/id.js'

/** 一条自定义提示词；默认提示词的 id 固定为 default */
export type UserPrompt = {
  id: string
  title: string
  content: string
}

export const DEFAULT_PROMPT_ID = 'default'

/** demo 原有的助手身份说明，作为默认提示词内容 */
export const DEFAULT_PROMPT_CONTENT = '该助手为DeepSeek，由深度求索公司创造。'

type PromptState = {
  prompts: UserPrompt[]
  /** 当前应用的提示词 id；null 表示不使用任何提示词 */
  activeId: string | null
}

const STORAGE_KEY = 'chat-demo:user-prompts'

const defaultPrompt = (): UserPrompt => ({
  id: DEFAULT_PROMPT_ID,
  title: '默认',
  content: DEFAULT_PROMPT_CONTENT,
})

const load = (): PromptState => {
  const fallback: PromptState = { prompts: [defaultPrompt()], activeId: DEFAULT_PROMPT_ID }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<PromptState>
    if (!Array.isArray(parsed.prompts)) {
      return fallback
    }
    // 规范化：过滤非法项、保证默认提示词始终存在且排第一、去重 id
    const seen = new Set<string>()
    const prompts = parsed.prompts
      .filter(
        (item): item is UserPrompt =>
          !!item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.content === 'string'
      )
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    if (!prompts.some((item) => item.id === DEFAULT_PROMPT_ID)) {
      prompts.unshift(defaultPrompt())
    }
    const activeId =
      parsed.activeId === null
        ? null
        : prompts.some((item) => item.id === parsed.activeId)
          ? (parsed.activeId as string)
          : DEFAULT_PROMPT_ID
    return { prompts, activeId }
  } catch {
    return fallback
  }
}

const persist = (state: PromptState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用时只在内存中生效
  }
}

export const usePrompts = create<PromptState>(() => load())

export const addPrompt = () => {
  const prompts = [...usePrompts.getState().prompts]
  const usedTitles = new Set(prompts.map((item) => item.title))
  let index = prompts.length
  let title = `提示词${index}`
  while (usedTitles.has(title)) {
    index += 1
    title = `提示词${index}`
  }
  const next = { prompts: [...prompts, { id: createId(), title, content: '' }], activeId: usePrompts.getState().activeId }
  persist(next)
  usePrompts.setState(next)
}

export const removePrompt = (id: string) => {
  if (id === DEFAULT_PROMPT_ID) {
    return
  }
  const state = usePrompts.getState()
  const prompts = state.prompts.filter((item) => item.id !== id)
  const activeId = state.activeId === id ? DEFAULT_PROMPT_ID : state.activeId
  const next = { prompts, activeId }
  persist(next)
  usePrompts.setState(next)
}

export const updatePrompt = (id: string, patch: Partial<Pick<UserPrompt, 'title' | 'content'>>) => {
  const state = usePrompts.getState()
  const prompts = state.prompts.map((item) => (item.id === id ? { ...item, ...patch } : item))
  const next = { prompts, activeId: state.activeId }
  persist(next)
  usePrompts.setState(next)
}

export const applyPrompt = (id: string | null) => {
  const next = { prompts: usePrompts.getState().prompts, activeId: id }
  persist(next)
  usePrompts.setState(next)
}

/** 取当前应用提示词的内容；不使用或找不到时返回空串 */
export const getActiveSystemPrompt = (): string => {
  const { prompts, activeId } = usePrompts.getState()
  if (activeId === null) {
    return ''
  }
  return prompts.find((item) => item.id === activeId)?.content ?? ''
}
