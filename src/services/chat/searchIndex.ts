import { loadSession } from './db.js'
import { getReplyText } from './reply.js'
import type { Session, SessionSummary } from './types.js'

/**
 * 会话全文索引：只在用户第一次搜索时建立，之后按 updatedAt 增量更新。
 * 只保留消息 id + 归一化后的纯文本，不保留块结构，内存占用约为会话数据的十分之一。
 */
type EntryMessage = { id: string; text: string }
type Entry = { updatedAt: number; title: string; messages: EntryMessage[] }

export type ChatSearchHit = {
  sessionId: string
  title: string
  /** 命中的消息；仅标题命中时为 null，点击后只打开会话、不定位 */
  messageId: string | null
  snippet: string
}

/** 多段空白压成单空格，让换行不打断高亮片段；匹配与展示都用这份文本，索引天然对齐。 */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

const toEntry = (summary: SessionSummary, session: Session): Entry => ({
  updatedAt: summary.updatedAt,
  title: normalize(summary.title || ''),
  messages: session.messages
    .map((message) => ({
      id: message.id,
      text: normalize(
        message.role === 'user'
          ? message.content
          : getReplyText(message)
      ),
    }))
    .filter((message) => message.text.length > 0),
})

const entries = new Map<string, Entry>()
let pending: Promise<void> | null = null

/** 建索引期间界面显示「正在建立搜索索引」；完成后再次调用只补新增或改动的会话。 */
export const isIndexing = () => pending !== null

export const primeSearchIndex = (sessions: SessionSummary[]): Promise<void> => {
  if (pending) {
    return pending
  }
  pending = (async () => {
    for (const [index, summary] of sessions.entries()) {
      const cached = entries.get(summary.id)
      if (cached?.updatedAt === summary.updatedAt) {
        continue
      }
      try {
        const session = await loadSession(summary.id)
        if (session) {
          entries.set(summary.id, toEntry(summary, session))
        }
      } catch {
        // 单个会话读取失败不影响其余结果
      }
      // 每 8 个会话让出一次主线程，避免输入卡顿
      if (index % 8 === 7) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  })().finally(() => {
    pending = null
  })
  return pending
}

/** 会话被删除或导入覆盖后调用，防止索引里残留旧文本。 */
export const dropSearchEntry = (sessionId: string) => {
  entries.delete(sessionId)
}

export const clearSearchIndex = () => entries.clear()

const makeSnippet = (text: string, at: number) => {
  const start = Math.max(0, at - 26)
  const end = Math.min(text.length, at + 78)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** 标题命中优先，其次正文命中；结果顺序沿用传入的会话顺序（按更新时间降序）。 */
export const searchChats = (query: string, sessions: SessionSummary[]): ChatSearchHit[] => {
  const keyword = normalize(query).toLowerCase()
  if (!keyword) {
    return []
  }
  const hits: ChatSearchHit[] = []
  for (const summary of sessions) {
    const entry = entries.get(summary.id)
    const title = summary.title || entry?.title || ''
    if (title.toLowerCase().includes(keyword)) {
      hits.push({ sessionId: summary.id, title, messageId: null, snippet: '' })
      continue
    }
    const message = entry?.messages.find((item) => item.text.toLowerCase().includes(keyword))
    if (!message) {
      continue
    }
    const at = message.text.toLowerCase().indexOf(keyword)
    hits.push({
      sessionId: summary.id,
      title,
      messageId: message.id,
      snippet: makeSnippet(message.text, at),
    })
    if (hits.length >= 50) {
      break
    }
  }
  return hits
}
