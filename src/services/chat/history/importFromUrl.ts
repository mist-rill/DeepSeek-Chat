import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * 通过官方导出的下载链接直接取回 ZIP。
 *
 * 为什么原生端不用 fetch：WebView 里的跨域请求受 CORS 限制，而官方下载链接（华为云 OBS
 * 预签名地址）不返回 `Access-Control-Allow-Origin`，fetch 会被浏览器拦掉。
 * CapacitorHttp 走原生 HTTP 栈，不受 CORS 约束；再配合 Range 分段，还能拿到真实百分比。
 */

/** 单次下载上限，防止误贴超大链接把内存吃满 */
const MAX_BYTES = 200 * 1024 * 1024

export class DownloadError extends Error {
  /** 用于 i18n 的原因 key，UI 层翻译 */
  readonly reason:
    | 'invalidUrl'
    | 'httpStatus'
    | 'expired'
    | 'network'
    | 'notArchive'
    | 'tooLarge'
    | 'unsupported'
  readonly detail?: string

  constructor(reason: DownloadError['reason'], detail?: string) {
    super(detail ?? reason)
    this.name = 'DownloadError'
    this.reason = reason
    this.detail = detail
  }
}

/**
 * 预签名链接过期后，华为云 OBS 返回 403 + XML 错误体（SignatureDoesNotMatch），
 * 而不是 404。这类状态单独区分，才能提示「回官方 App 重新导出」而不是干巴巴的 403。
 */
/** CapacitorHttp 的失败（DNS / 超时 / 证书 / 连接被拒）统一归为 network */
const nativeGet = async (options: Parameters<typeof CapacitorHttp.get>[0]) => {
  try {
    return await CapacitorHttp.get(options)
  } catch (error) {
    throw new DownloadError('network', error instanceof Error ? error.message : String(error))
  }
}

const statusError = (status: number) => {
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return new DownloadError('expired', String(status))
  }
  return new DownloadError('httpStatus', String(status))
}

const guessFileName = (url: string) => {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    if (last && last.includes('.')) return last
  } catch {
    /* 交给下面的兜底 */
  }
  return 'deepseek_data.zip'
}

const assertUrl = (raw: string) => {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new DownloadError('invalidUrl')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new DownloadError('invalidUrl')
  }
  return parsed.href
}

/** ZIP 的本地文件头 / 空归档头，用来快速判断链接返回的是不是压缩包 */
const looksLikeZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))

const base64ToBytes = (value: string) => {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * 进度回调：percent 为 null 表示总长度未知，只能显示不定进度。
 * totalBytes 为 0 表示服务端没给长度。
 */
export type DownloadProgress = (percent: number | null, receivedBytes: number, totalBytes?: number) => void

/** 分段大小：每段都会以 base64 经桥传回 JS，4MB 一段既不撑爆内存也够少次请求 */
const CHUNK_BYTES = 4 * 1024 * 1024

/** 响应头大小写不固定（原生侧保留服务端原始大小写），统一小写查 */
const headerOf = (headers: Record<string, string> | undefined, name: string) => {
  if (!headers) return ''
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name)
  return key ? String(headers[key]) : ''
}

/** 从 `bytes 0-0/38008434` 里取出总长度 */
const parseContentRangeTotal = (value: string) => {
  const match = /\/\s*(\d+)\s*$/.exec(value)
  return match ? Number(match[1]) : 0
}

/**
 * 原生下载：用 HTTP Range 分段取回，再拼成一个 File。
 *
 * 为什么不一次性 `CapacitorHttp.get`：
 * 1. 原生把二进制转成 base64 一次性过桥，38MB 的官方导出包会变成 ~51MB 的 JS 字符串，
 *    低端机容易 OOM，传输也要好几秒卡住主线程；
 * 2. 一次性下载拿不到任何中间进度，用户面对 38MB 只能干等。
 *
 * 分段后每段 4MB（base64 约 5.4MB），既能逐段上报百分比，也不会出现超大单条桥消息。
 * 若服务端不支持 Range（返回 200 而不是 206），第一段就已经拿到完整文件，直接采用。
 */
const downloadNative = async (url: string, onProgress: DownloadProgress): Promise<File> => {
  onProgress(null, 0, 0)

  const first = await nativeGet({
    url,
    responseType: 'blob',
    headers: { Range: `bytes=0-${CHUNK_BYTES - 1}` },
    connectTimeout: 30_000,
    readTimeout: 180_000
  })
  if (first.status < 200 || first.status >= 300) {
    throw statusError(first.status)
  }
  if (typeof first.data !== 'string') {
    throw new DownloadError('unsupported')
  }

  // 服务端忽略 Range，直接返回了整包：不用再发请求
  if (first.status !== 206) {
    // 先看声明长度，避免先把 200MB+ 解成字节再拒绝
    const declared = Number(headerOf(first.headers, 'content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new DownloadError('tooLarge')
    }
    const whole = base64ToBytes(first.data)
    if (whole.byteLength > MAX_BYTES) {
      throw new DownloadError('tooLarge')
    }
    if (!looksLikeZip(whole)) {
      throw new DownloadError('notArchive')
    }
    onProgress(100, whole.byteLength, whole.byteLength)
    return new File([whole], guessFileName(url), { type: 'application/zip' })
  }

  const total = parseContentRangeTotal(headerOf(first.headers, 'content-range'))
  if (total > MAX_BYTES) {
    throw new DownloadError('tooLarge')
  }

  const head = base64ToBytes(first.data)
  if (!looksLikeZip(head)) {
    throw new DownloadError('notArchive')
  }

  // 不知道总长度时按「一段就是全部」退化处理，避免无限循环
  if (!total) {
    onProgress(100, head.byteLength, head.byteLength)
    return new File([head], guessFileName(url), { type: 'application/zip' })
  }

  // 预分配整块内存：峰值只有「完整数组 + 一段」，比先收集再合并省一半
  const merged = new Uint8Array(total)
  merged.set(head.subarray(0, Math.min(head.byteLength, total)), 0)
  let received = Math.min(head.byteLength, total)
  onProgress(Math.min(99, Math.round((received / total) * 100)), received, total)

  let offset = received
  while (offset < total) {
    const end = Math.min(offset + CHUNK_BYTES, total) - 1
    const part = await nativeGet({
      url,
      responseType: 'blob',
      headers: { Range: `bytes=${offset}-${end}` },
      connectTimeout: 30_000,
      readTimeout: 180_000
    })
    if (part.status !== 206 && part.status !== 200) {
      throw statusError(part.status)
    }
    if (typeof part.data !== 'string') {
      throw new DownloadError('unsupported')
    }
    const chunk = base64ToBytes(part.data)
    if (!chunk.byteLength) {
      throw new DownloadError('httpStatus', 'empty-chunk')
    }
    const room = total - offset
    merged.set(chunk.subarray(0, Math.min(chunk.byteLength, room)), offset)
    offset += Math.min(chunk.byteLength, room)
    received = offset
    onProgress(Math.min(99, Math.round((received / total) * 100)), received, total)
  }

  onProgress(100, total, total)
  return new File([merged], guessFileName(url), { type: 'application/zip' })
}

const downloadWeb = async (url: string, onProgress: DownloadProgress): Promise<File> => {
  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    throw new DownloadError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw statusError(response.status)
  }
  const declared = Number(response.headers.get('content-length') ?? '')
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0
  if (total > MAX_BYTES) {
    throw new DownloadError('tooLarge')
  }

  if (!response.body) {
    const blob = await response.blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!looksLikeZip(bytes)) {
      throw new DownloadError('notArchive')
    }
    onProgress(100, bytes.byteLength, bytes.byteLength)
    return new File([bytes], guessFileName(url), { type: 'application/zip' })
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > MAX_BYTES) {
      await reader.cancel()
      throw new DownloadError('tooLarge')
    }
    chunks.push(value)
    onProgress(total ? Math.min(99, Math.round((received / total) * 100)) : null, received, total)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (!looksLikeZip(merged)) {
    throw new DownloadError('notArchive')
  }
  onProgress(100, received, total || received)
  return new File([merged], guessFileName(url), { type: 'application/zip' })
}

/** 下载归档：原生走 CapacitorHttp 绕开 CORS，浏览器走流式 fetch 以便显示百分比 */
export const downloadArchive = (url: string, onProgress: DownloadProgress): Promise<File> => {
  const safeUrl = assertUrl(url)
  return Capacitor.isNativePlatform()
    ? downloadNative(safeUrl, onProgress)
    : downloadWeb(safeUrl, onProgress)
}
