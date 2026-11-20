import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseFill14, IconSearchOutline16 } from '../base/icons.js'
import type { ChatSearchHit } from '../../services/chat/searchIndex.js'
import styles from './SessionSearch.module.css'

/** 搜索框：与「开启新对话」等宽的胶囊输入框，只负责取值。 */
export const SessionSearchBox = ({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  return (
    <div className={styles.box}>
      <span className={styles.icon}>
        <IconSearchOutline16 />
      </span>
      <input
        className={styles.input}
        type="text"
        value={value}
        placeholder={t('searchChatPlaceholder')}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label={t('close')}
          onClick={() => onChange('')}
        >
          <IconCloseFill14 />
        </button>
      ) : null}
    </div>
  )
}

/** 把片段里命中的关键词标出来；只做纯文本切分，不插入 HTML。 */
const Snippet = ({ text, keyword }: { text: string; keyword: string }) => {
  const needle = keyword.trim().toLowerCase()
  if (!needle) {
    return <>{text}</>
  }
  const haystack = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    if (at > from) {
      parts.push(text.slice(from, at))
    }
    parts.push(
      <mark key={`${at}-${parts.length}`} className={styles.mark}>
        {text.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
    at = haystack.indexOf(needle, from)
  }
  if (from < text.length) {
    parts.push(text.slice(from))
  }
  return <>{parts}</>
}

/** 搜索结果列表：标题命中显示标题行，正文命中显示命中的前后文。 */
export const SessionSearchResults = memo(function SessionSearchResults({
  hits,
  keyword,
  indexing,
  untitled,
  onSelect,
}: {
  hits: ChatSearchHit[]
  keyword: string
  indexing: boolean
  untitled: string
  onSelect: (hit: ChatSearchHit) => void
}) {
  const t = useTranslate()
  if (indexing) {
    return <div className={styles.tip}>{t('searchChatIndexing')}</div>
  }
  if (hits.length === 0) {
    return <div className={styles.tip}>{t('searchChatNoResult')}</div>
  }
  return (
    <div className={styles.results}>
      {hits.map((hit) => (
        <button
          key={hit.sessionId}
          type="button"
          className={styles.row}
          onClick={() => onSelect(hit)}
        >
          <span className={styles.title}>
            <Snippet text={hit.title || untitled} keyword={keyword} />
          </span>
          {hit.messageId ? (
            <span className={styles.snippet}>
              <Snippet text={hit.snippet} keyword={keyword} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
})
