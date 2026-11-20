import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * 运行日志：劫持 console、捕获全局异常、记录网络请求，导出成 txt 供排查问题。
 *
 * 设计取舍：
 * - 内存保留最近 1500 条，localStorage 只持久化最近 300 条（防冷启动后一片空白，
 *   也避免频繁写盘拖慢聊天）。写盘做了 3 秒防抖。
 * - 只记方法、URL 路径、状态码、耗时，**不记请求体和请求头**，避免 API Key 泄漏；
 *   导出前还会把 `sk-xxxx` 形态的字符串再脱敏一次。
 */

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'net' | 'sys'

interface LogEntry {
  at: number
  level: LogLevel
  text: string
  /** 短时间内重复的同一条日志合并计数 */
  count?: number
}

/** 内存里最多保留多少条 */
const MAX_ENTRIES = 1500
/** 持久化到 localStorage 的条数 */
const PERSIST_ENTRIES = 300
/** 导出时只取最近 24 小时 */
const RETENTION_MS = 24 * 60 * 60 * 1000
const STORAGE_KEY = 'chat-demo:diagnostic-log'
const MAX_TEXT_LENGTH = 1200
/** 相同日志在此时间窗内合并，避免刷屏 */
const DEDUPE_WINDOW_MS = 800
const PERSIST_DEBOUNCE_MS = 3000

const entries: LogEntry[] = []
let installed = false
let persistTimer: number | null = null

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

export const formatTime = (at: number) => {
  const date = new Date(at)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  )
}

const stampForFile = (at: number) => {
  const date = new Date(at)
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 把任意值变成一行可读文本，对象走 JSON、异常带类型名 */
const describe = (value: unknown, depth = 0): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`
  if (value instanceof Error) {
    return value.stack && depth === 0 ? `${value.name}: ${value.message}\n${value.stack}` : `${value.name}: ${value.message}`
  }
  if (value instanceof Element) {
    return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ''}>`
  }
  if (depth > 2) return '…'
  try {
    const json = JSON.stringify(
      value,
      (_key, item) => {
        if (typeof item === 'bigint') return String(item)
        if (item instanceof Error) return `${item.name}: ${item.message}`
        return item
      },
      0
    )
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

const joinParts = (parts: unknown[]) =>
  parts
    .map((part) => describe(part))
    .join(' ')
    .slice(0, MAX_TEXT_LENGTH)

const schedulePersist = () => {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-PERSIST_ENTRIES)))
    } catch {
      /* 存储满或被禁用时忽略，日志不该影响主流程 */
    }
  }, PERSIST_DEBOUNCE_MS)
}

export const pushLog = (level: LogLevel, parts: unknown[]) => {
  const text = joinParts(parts)
  if (!text) return
  const at = Date.now()
  const last = entries[entries.length - 1]
  if (last && last.level === level && last.text === text && at - last.at < DEDUPE_WINDOW_MS) {
    last.count = (last.count ?? 1) + 1
    return
  }
  entries.push({ at, level, text })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  schedulePersist()
}

/** 去掉 query，避免把可能带 token 的参数写进日志 */
const sanitizeUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.slice(0, 200)
  }
}

const restorePersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as LogEntry[]
    if (!Array.isArray(saved)) return
    const cutoff = Date.now() - RETENTION_MS
    for (const item of saved) {
      if (!item || typeof item.at !== 'number' || typeof item.text !== 'string') continue
      if (item.at < cutoff) continue
      entries.push({ at: item.at, level: item.level ?? 'log', text: item.text, count: item.count })
    }
    entries.sort((a, b) => a.at - b.at)
  } catch {
    /* 损坏的旧日志直接丢弃 */
  }
}

const hookConsole = () => {
  const levels: { key: 'log' | 'info' | 'warn' | 'error' | 'debug'; level: LogLevel }[] = [
    { key: 'log', level: 'log' },
    { key: 'info', level: 'info' },
    { key: 'warn', level: 'warn' },
    { key: 'error', level: 'error' },
    { key: 'debug', level: 'log' },
  ]
  for (const { key, level } of levels) {
    const original = console[key].bind(console)
    console[key] = (...args: unknown[]) => {
      pushLog(level, args)
      original(...args)
    }
  }
}

const hookErrors = () => {
  window.addEventListener('error', (event) => {
    if (event instanceof ErrorEvent) {
      pushLog('error', [
        `未捕获异常：${event.message}`,
        event.filename ? `@ ${event.filename}:${event.lineno}:${event.colno}` : ''
      ])
    } else {
      // 资源加载失败（img/script 等），target 指向具体元素
      pushLog('error', ['资源加载失败：', (event as unknown as Event).target])
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    pushLog('error', ['未处理的 Promise 拒绝：', event.reason])
  })
}

const hookFetch = () => {
  const original = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const target = sanitizeUrl(url)
    try {
      const response = await original(input, init)
      const cost = Date.now() - started
      // 流式响应读到一半断开时，日志里能看到请求本身的成败
      pushLog(response.ok ? 'net' : 'error', [
        `${method} ${target} → ${response.status}${response.statusText ? ` ${response.statusText}` : ''} (${cost}ms)`
      ])
      return response
    } catch (error) {
      pushLog('error', [`${method} ${target} 请求失败：${describe(error)} (${Date.now() - started}ms)`])
      throw error
    }
  }) as typeof window.fetch
}

const logEnvironment = () => {
  pushLog('sys', [`平台 ${Capacitor.getPlatform()}，原生 ${Capacitor.isNativePlatform() ? '是' : '否'}`])
  pushLog('sys', [
    `屏幕 ${window.screen.width}×${window.screen.height}，dpr ${window.devicePixelRatio}，视口 ${window.innerWidth}×${window.innerHeight}`
  ])
  pushLog('sys', [`语言 ${navigator.language}，UA ${navigator.userAgent}`])
  if (Capacitor.isNativePlatform()) {
    void CapacitorApp.getInfo()
      .then((info) => pushLog('sys', [`应用 ${info.name} ${info.version} (${info.build})，包名 ${info.id}`]))
      .catch(() => undefined)
  }
}

/** 幂等：重复调用只生效一次。应在应用入口尽早调用，才能抓到启动阶段的日志。 */
export const installDiagnostics = () => {
  if (installed) return
  installed = true
  restorePersisted()
  hookConsole()
  hookErrors()
  hookFetch()
  pushLog('sys', ['———— 应用启动 ————'])
  logEnvironment()
}

/** 导出前最后一道脱敏，防止某处日志里带出 key */
const maskSecrets = (text: string) =>
  text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._-]{12,}/gi, '$1 ***')

export const getLogEntries = () => entries.slice()

/** 组装导出文本：设备信息 + 最近 24 小时日志 */
export const buildLogText = async () => {
  const now = Date.now()
  const cutoff = now - RETENTION_MS
  let recent = entries.filter((entry) => entry.at >= cutoff)
  if (recent.length === 0) {
    recent = entries.slice(-200)
  }

  let version = '未知'
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await CapacitorApp.getInfo()
      version = `${info.name} ${info.version} (${info.build}) / ${info.id}`
    } catch {
      /* 忽略：拿不到版本不影响导出 */
    }
  }

  const header = [
    'DeepSeek Chat 运行日志',
    `导出时间：${formatTime(now)}`,
    `应用：${version}`,
    `平台：${Capacitor.getPlatform()}（${Capacitor.isNativePlatform() ? '原生 App' : '浏览器'}）`,
    `系统语言：${navigator.language}`,
    `屏幕：${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x，视口 ${window.innerWidth}×${window.innerHeight}`,
    `UA：${navigator.userAgent}`,
    `日志条数：${recent.length}${
      recent.length > 0 ? `（${formatTime(recent[0].at)} ~ ${formatTime(recent[recent.length - 1].at)}）` : ''
    }`,
    '━'.repeat(40)
  ]

  const body = recent.map((entry) => {
    const count = entry.count && entry.count > 1 ? ` (×${entry.count})` : ''
    return `[${formatTime(entry.at)}] [${entry.level.toUpperCase()}] ${entry.text}${count}`
  })

  return maskSecrets([...header, ...body, ''].join('\n'))
}

/**
 * 导出日志：原生端写进缓存目录再唤起系统分享面板（可存文件 / 发微信 / 发邮件），
 * 浏览器端直接下载。返回文件名便于提示。
 */
export const exportLogs = async () => {
  const text = await buildLogText()
  const fileName = `deepseek-log-${stampForFile(Date.now())}.txt`

  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return fileName
  }

  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true
  })

  await Share.share({
    title: fileName,
    text: 'DeepSeek Chat 运行日志',
    url: uri,
    dialogTitle: '导出运行日志'
  })

  return fileName
}
