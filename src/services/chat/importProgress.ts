import { create } from 'zustand'

/**
 * 导入进度：下载 → 校验 → 写入三个阶段共用一份状态，
 * 设置弹窗里的确认框和主界面顶部的状态条都读它。
 */
export type ImportStage = 'idle' | 'download' | 'verify' | 'import' | 'done' | 'failed'

export interface ImportProgressState {
  stage: ImportStage
  /** 已处理的归档条目数（会话 JSON + 图片） */
  processed: number
  /** 归档条目总数，未知时为 0 */
  total: number
  /** 下载百分比；总长度未知时为 null（不定进度） */
  downloadPercent: number | null
  /** 已下载字节数，用于显示 "16.2 / 36.3 MB" */
  downloadedBytes: number
  /** 归档总字节数，未知时为 0 */
  totalBytes: number
  /** 已经写入暂存的会话数 */
  sessions: number
  /** 失败原因（直接展示给用户） */
  error: string
}

const INITIAL: ImportProgressState = {
  stage: 'idle',
  processed: 0,
  total: 0,
  downloadPercent: null,
  downloadedBytes: 0,
  totalBytes: 0,
  sessions: 0,
  error: ''
}

export const useImportProgress = create<ImportProgressState>(() => ({ ...INITIAL }))

export const setImportProgress = (patch: Partial<ImportProgressState>) =>
  useImportProgress.setState(patch)

export const resetImportProgress = () => useImportProgress.setState({ ...INITIAL })

/** 只有真正在跑的时候才显示全局状态条 */
export const isImportRunning = (stage: ImportStage) =>
  stage === 'download' || stage === 'verify' || stage === 'import'

/** 字节数转人类可读体积，用于下载进度副标题（38MB 的官方导出包需要让用户看到具体进度） */
export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
