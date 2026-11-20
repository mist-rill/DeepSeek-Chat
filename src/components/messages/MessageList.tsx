import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { clearMessageJump, useMessageJump } from '../../services/chat/pendingJump.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollJumpPad } from './ScrollJumpPad.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 距顶 / 距底小于该值时隐藏对应的跳转箭头 */
const EDGE_THRESHOLD = 12
/** 停止滑动后箭头保留的时间 */
const PAD_IDLE_MS = 1500
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const jumpTarget = useMessageJump((state) => state.target)
  // 三个值合成一个 state，避免每次滚动触发两三次渲染
  const [pad, setPad] = useState({ up: false, down: false, visible: false })
  const padTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id

  const hidePad = useCallback(() => {
    clearTimeout(padTimerRef.current)
    setPad((prev) => (prev.visible ? { ...prev, visible: false } : prev))
  }, [])

  /** 滚动过程中刷新箭头方向，并顺延隐藏定时器 */
  const refreshPad = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const max = el.scrollHeight - el.clientHeight
    if (max <= 48) {
      hidePad()
      return
    }
    const up = el.scrollTop > EDGE_THRESHOLD
    const down = max - el.scrollTop > EDGE_THRESHOLD
    setPad((prev) =>
      prev.up === up && prev.down === down && prev.visible ? prev : { up, down, visible: true }
    )
    clearTimeout(padTimerRef.current)
    padTimerRef.current = setTimeout(hidePad, PAD_IDLE_MS)
  }, [hidePad])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  // 从搜索结果进入会话时定位到命中的那条消息，并短暂高亮
  useEffect(() => {
    if (!jumpTarget || jumpTarget.sessionId !== session.id) {
      return
    }
    stickyRef.current = false
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const target = scroller?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(jumpTarget.messageId)}"]`
      )
      if (target) {
        target.scrollIntoView({ block: 'center' })
        target.classList.add(styles.jumpFlash)
        setTimeout(() => target.classList.remove(styles.jumpFlash), 1600)
      }
      clearMessageJump()
    })
    return () => cancelAnimationFrame(frame)
  }, [jumpTarget, session.id])

  useEffect(() => closeSearchPanel, [session.id, lastMessageId])

  useEffect(() => () => clearTimeout(padTimerRef.current), [])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    // 只认真正的手势和滚轮：程序化滚动（进会话自动到底）不该弹出箭头
    const onUserScroll = () => refreshPad()
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onUserScroll, { passive: true })
    el.addEventListener('touchmove', onUserScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onUserScroll)
      el.removeEventListener('touchmove', onUserScroll)
    }
  }, [isMobile, scrollToBottom, refreshPad])

  const jumpToTop = () => {
    stickyRef.current = false
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    hidePad()
  }

  const jumpToBottom = () => {
    stickyRef.current = true
    const el = scrollRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    hidePad()
  }

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div className={styles.stage}>
        <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div ref={contentRef} className={styles.column}>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )
              )}
            </div>
          </div>
          {footer}
        </div>
        {pad.visible && (pad.up || pad.down) ? (
          <ScrollJumpPad
            up={pad.up}
            down={pad.down}
            onUp={jumpToTop}
            onDown={jumpToBottom}
            upLabel={t('scrollToTop')}
            downLabel={t('scrollToBottom')}
          />
        ) : null}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
