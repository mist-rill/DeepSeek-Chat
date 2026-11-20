import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16 } from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import { dropSearchEntry, primeSearchIndex, searchChats } from '../../services/chat/searchIndex.js'
import type { ChatSearchHit } from '../../services/chat/searchIndex.js'
import { forgetPin, usePinnedSessions } from '../../services/chat/pinned.js'
import { requestMessageJump } from '../../services/chat/pendingJump.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { SessionSearchBox, SessionSearchResults } from './SessionSearch.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、搜索、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const pinnedIds = usePinnedSessions((state) => state.ids)
  const [now, setNow] = useState(Date.now)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatSearchHit[]>([])
  const [indexing, setIndexing] = useState(false)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const pinnedSessions = useMemo(
    () =>
      pinnedIds
        .map((id) => sessions.find((session) => session.id === id))
        .filter((session): session is SessionSummary => session !== undefined),
    [pinnedIds, sessions]
  )
  const groups = useMemo(
    () =>
      groupSessions(
        sessions.filter((session) => !pinnedIds.includes(session.id)),
        now,
        t
      ),
    [sessions, pinnedIds, now, t]
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // 有搜索词时先确保索引就绪，再按会话顺序取结果
  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setHits([])
      setIndexing(false)
      return
    }
    let alive = true
    setIndexing(true)
    const current = useChatStore.getState().sessions
    void primeSearchIndex(current).then(() => {
      if (!alive) {
        return
      }
      setHits(searchChats(keyword, current))
      setIndexing(false)
    })
    return () => {
      alive = false
    }
  }, [query])

  const openHit = (hit: ChatSearchHit) => {
    // 先登记跳转目标，再切会话，会话页首帧就能定位
    if (hit.messageId) {
      requestMessageJump(hit.sessionId, hit.messageId)
    }
    selectSession(hit.sessionId)
    setQuery('')
    closeMobileSider()
  }

  const removeAndForget = async (id: string) => {
    if (!(await removeSession(id))) {
      return false
    }
    forgetPin(id)
    dropSearchEntry(id)
    return true
  }

  const searching = query.trim().length > 0

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <div className={styles.searchBoxWrap}>
        <SessionSearchBox value={query} onChange={setQuery} />
      </div>
      {searching ? (
        <div className={styles.searchWrap}>
          <SessionSearchResults
            hits={hits}
            keyword={query.trim()}
            indexing={indexing}
            untitled={t('untitledChat')}
            onSelect={openHit}
          />
        </div>
      ) : (
        <div className={styles.listWrap}>
          <div className={styles.list}>
            {pinnedSessions.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>{t('pinnedSessions')}</div>
                {pinnedSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    pinned
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ) : null}
            {groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeAndForget(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * 移动端抽屉：浮在页面上方，点空白区域关闭。
 * 左右滑动由 App 统一接管（全屏可滑、按拖动距离跟手），这里只负责层级与开合状态。
 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)

  return (
    <>
      <div
        className={clsx(styles.drawerMask, !open && styles.drawerMaskHidden)}
        onClick={closeMobileSider}
      />
      <div data-drawer className={clsx(styles.drawer, !open && styles.drawerHidden)}>
        <Sider mobile />
      </div>
    </>
  )
}
