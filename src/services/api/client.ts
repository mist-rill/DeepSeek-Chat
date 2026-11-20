import { translate, type TranslationMessage } from '../../i18n/index.js'
import * as db from '../chat/db.js'
import { useSettings } from '../settings.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
  StopReason,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__

/**
 * 官方走 Anthropic 兼容接口（{官方}/anthropic 下的 /v1/*）；
 * 设置里填了自定义 Base URL 就走 OpenAI 兼容协议（用户填到 /v1 为止，程序拼 /chat/completions）。
 */
const isCustomEndpoint = (): boolean => Boolean(useSettings.getState().apiBaseUrl?.trim())

/** 自定义接口的根地址：原样使用（惯例填到 /v1 为止），只去掉末尾斜杠 */
const openaiBase = (): string => (useSettings.getState().apiBaseUrl ?? '').trim().replace(/\/+$/, '')

/** 自定义接口不下真上传：原件登记在内存里，发请求时转成 base64 内联 */
const localFiles = new Map<string, { blob: Blob; name: string }>()
const LOCAL_PREFIX = 'local:'

/**
 * Anthropic 兼容接口的根地址：没填自定义 Base URL 走官方（到 /anthropic 为止的根）。
 * 消息、文件、模型列表都在这个根下的 /v1 上。
 */
const anthropicBase = (): string => `${API_ORIGIN}/anthropic`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // Anthropic 原生用 x-api-key；OpenAI 风格网关只认 Authorization: Bearer，两个都带上兼容两边
  'x-api-key': apiKey,
  Authorization: `Bearer ${apiKey}`,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 校验 API Key 与接口连通性（不产生费用）：官方 GET /v1/models，自定义 GET /models */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  if (isCustomEndpoint()) {
    await request(`${openaiBase()}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    return
  }
  await request(`${anthropicBase()}/v1/models`, {
    method: 'GET',
    headers: anthropicHeaders(apiKey, false),
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 * 自定义接口不真上传：登记原件并返回 local: 假 id，发请求时转 base64 内联。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal,
  localId?: string
): Promise<FileObject> => {
  if (isCustomEndpoint()) {
    const key = `${LOCAL_PREFIX}${localId ?? `anon-${file.name}-${file.size}`}`
    localFiles.set(key, { blob: file, name: file.name })
    return {
      id: key,
      type: 'file',
      size_bytes: file.size,
      created_at: new Date().toISOString(),
      filename: file.name,
      mime_type: file.type,
    }
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${anthropicBase()}/v1/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id}；自定义接口没有服务端文件，直接忽略 */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  if (isCustomEndpoint()) {
    return
  }
  await request(`${anthropicBase()}/v1/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 自定义接口 / 模型的常见坑翻成人话：识图不支持、思考模式不支持、Key 不对、路径不对。
 * 服务端的原始报错放在 detail 里保留线索，没有原始报错就不带 params。
 */
const friendlyError = (error: unknown, images: boolean): unknown => {
  if (!(error instanceof ApiError) || error.localMessage) {
    return error
  }
  const detail = error.message
  const params = detail ? { detail } : undefined
  const hit = (pattern: RegExp) => pattern.test(detail)
  if (images && error.status === 400 && hit(/image|图片|vision|visual|multimodal|多模态|视觉|模态/i)) {
    return new ApiError(error.kind, { key: 'apiErrorImageUnsupported', params }, error.status)
  }
  if (error.status === 400 && hit(/thinking|reasoning|思考|推理/i)) {
    return new ApiError(error.kind, { key: 'apiErrorThinkingUnsupported', params }, error.status)
  }
  if (error.status === 401 || error.status === 403) {
    return new ApiError(error.kind, { key: 'apiErrorAuth', params }, error.status)
  }
  if (error.status === 404) {
    return new ApiError(error.kind, { key: 'apiErrorNotFound', params }, error.status)
  }
  return error
}

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 * 填了自定义 Base URL 时改走 OpenAI 兼容协议（见 streamOpenAI）。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (isCustomEndpoint()) {
    yield* streamOpenAI(apiKey, body, signal)
    return
  }
  const images = hasFile(body)
  let response: Response
  try {
    response = await request(`${anthropicBase()}/v1/messages`, {
      method: 'POST',
      headers: {
        ...anthropicHeaders(apiKey, images),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    })
  } catch (error) {
    throw friendlyError(error, images)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

// ---------- OpenAI 兼容协议（自定义 Base URL） ----------

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string | OpenAIPart[] }

type OpenAIChunk = {
  id?: string
  model?: string
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[]
  error?: ApiErrorBody['error']
}

const OPENAI_STOP_REASON: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new ApiError('network', 'failed to read local file'))
    reader.readAsDataURL(blob)
  })

/** local: 假 id 还原原件：内存登记优先，重启后从本地库按附件 id 取 */
const loadLocalFile = async (fileId: string): Promise<{ blob: Blob; name: string } | null> => {
  const local = localFiles.get(fileId)
  if (local) {
    return local
  }
  if (!fileId.startsWith(LOCAL_PREFIX)) {
    return null
  }
  const blob = await db.loadFile(fileId.slice(LOCAL_PREFIX.length))
  return blob ? { blob, name: '' } : null
}

/** Anthropic 消息结构 → OpenAI messages；附件有本地原件的转 base64 内联，找不到的省略 */
const toOpenAIMessages = async (body: CreateMessageRequest): Promise<OpenAIMessage[]> => {
  const result: OpenAIMessage[] = []
  if (body.system.trim()) {
    result.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      result.push({ role: 'system', content: message.content })
      continue
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        result.push({ role: 'user', content: message.content })
        continue
      }
      let text = ''
      const parts: OpenAIPart[] = []
      for (const block of message.content) {
        if (block.type === 'text') {
          text = text ? `${text}\n\n${block.text}` : block.text
          continue
        }
        const local = await loadLocalFile(block.source.file_id)
        if (!local) {
          continue
        }
        if (text) {
          parts.push({ type: 'text', text })
          text = ''
        }
        const url = await blobToDataUrl(local.blob)
        parts.push(
          block.type === 'image'
            ? { type: 'image_url', image_url: { url } }
            : { type: 'file', file: { filename: local.name || 'document', file_data: url } }
        )
      }
      if (text) {
        parts.push({ type: 'text', text })
      }
      result.push({ role: 'user', content: parts.length > 0 ? parts : '' })
      continue
    }
    // assistant 只回传正文：思考块、服务端工具块第三方接口不认
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
    if (text.trim()) {
      result.push({ role: 'assistant', content: text })
    }
  }
  return result
}

/**
 * POST {base}/chat/completions（stream: true），OpenAI 兼容协议。
 * 流式增量转换为应用内的 Anthropic 风格事件：正文走 text 块，
 * 思考内容（reasoning_content / reasoning）走 thinking 块，[DONE] 或流结束即收尾。
 */
async function* streamOpenAI(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  // 服务端联网搜索是 DeepSeek 专属工具，第三方接口普遍不支持，开启时给出明确提示；
  // deepseek_read_url（阅读链接）对第三方没有意义，静默忽略即可。
  if (body.tools.some((tool) => tool.name === 'deepseek_web_search')) {
    throw new ApiError('http', { key: 'apiErrorSearchUnsupported' })
  }
  const messages = await toOpenAIMessages(body)
  let response: Response
  try {
    response = await request(`${openaiBase()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model: body.model, messages, stream: true }),
      signal,
    })
  } catch (error) {
    throw friendlyError(error, true)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let started = false
  let stopReason: StopReason | null = null
  /** 当前打开的内容块：思考 / 正文切换时先关旧块再开新块 */
  let currentType: 'text' | 'thinking' | null = null
  let currentIndex = -1
  let nextIndex = 0

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    const payload = data.trim()
    if (payload === '[DONE]') {
      break
    }
    let chunk: OpenAIChunk
    try {
      chunk = JSON.parse(payload) as OpenAIChunk
    } catch {
      continue
    }
    if (chunk.error?.message) {
      throw new ApiError('stream', chunk.error.message)
    }
    if (!started) {
      started = true
      yield { type: 'message_start', message: { id: chunk.id ?? '', model: chunk.model ?? body.model } }
    }
    const delta = chunk.choices?.[0]?.delta
    if (delta) {
      const reasoning =
        typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta.reasoning === 'string'
            ? delta.reasoning
            : ''
      if (reasoning) {
        if (currentType !== 'thinking') {
          if (currentType !== null) {
            yield { type: 'content_block_stop', index: currentIndex }
          }
          currentIndex = nextIndex++
          currentType = 'thinking'
          yield {
            type: 'content_block_start',
            index: currentIndex,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: currentIndex,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }
      }
      if (delta.content) {
        if (currentType !== 'text') {
          if (currentType !== null) {
            yield { type: 'content_block_stop', index: currentIndex }
          }
          currentIndex = nextIndex++
          currentType = 'text'
          yield { type: 'content_block_start', index: currentIndex, content_block: { type: 'text', text: '' } }
        }
        yield {
          type: 'content_block_delta',
          index: currentIndex,
          delta: { type: 'text_delta', text: delta.content },
        }
      }
    }
    const finish = chunk.choices?.[0]?.finish_reason
    if (finish) {
      stopReason = OPENAI_STOP_REASON[finish] ?? 'end_turn'
    }
  }
  if (!started) {
    throw new ApiError('interrupted', '')
  }
  if (currentType !== null) {
    yield { type: 'content_block_stop', index: currentIndex }
    currentType = null
  }
  yield { type: 'message_delta', delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null } }
  yield { type: 'message_stop' }
}
