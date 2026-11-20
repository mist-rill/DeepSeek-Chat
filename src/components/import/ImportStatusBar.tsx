import { useTranslate } from '../../i18n/index.js'
import { formatBytes, isImportRunning, useImportProgress } from '../../services/chat/importProgress.js'
import styles from './ImportStatusBar.module.css'

/**
 * 导入进行中的全局状态条：设置弹窗被关掉后，用户仍然能看到还剩多少。
 * 导入本身占用主线程写 IndexedDB，这时输入框是禁用的，状态条补上了「为什么不能发消息」的解释。
 */
export const ImportStatusBar = () => {
  const t = useTranslate()
  const { stage, processed, total, downloadPercent, downloadedBytes, totalBytes, sessions } =
    useImportProgress()

  if (!isImportRunning(stage)) {
    return null
  }

  const percent =
    stage === 'download'
      ? downloadPercent
      : total > 0
        ? Math.round((processed / total) * 100)
        : null

  const label =
    stage === 'download'
      ? downloadPercent === null
        ? t('importStageDownload')
        : `${t('importStageDownload')} ${downloadPercent}%`
      : stage === 'verify'
        ? t('importStageVerify')
        : total > 0
          ? t('importStageImport', { processed, total })
          : t('importStageImportUnknown', { sessions })

  const sub =
    stage === 'download' && totalBytes > 0
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
      : stage === 'import' && sessions > 0 && total > 0
        ? t('importStageSessions', { sessions })
        : ''

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {percent === null ? null : <span className={styles.percent}>{percent}%</span>}
      </div>
      <div className={styles.track}>
        <div
          className={percent === null ? styles.fillIndeterminate : styles.fill}
          style={percent === null ? undefined : { width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
    </div>
  )
}
