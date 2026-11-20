import { translate, type TranslationMessage } from '../../i18n/index.js'
import { useSettings } from '../settings.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__

/**
 * Anthropic 兼容接口的根地址：设置里填了自定义 Base URL 就用它
 * （用户填的是到 /anthropic 为止的根，比如 https://api.deepseek.com/anthropic），
 * 没填走官方。消息、文件、模型列表都在这个根下的 /v1 上。
 */
const anthropicBase = (): string => {
  const custom = useSettings.getState().apiBaseUrl?.trim()
  return custom ? custom.replace(/\/+$/, '') : `${API_ORIGIN}/anthropic`
}
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

/** 用 GET /v1/models 校验 API Key 与接口连通性（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${anthropicBase()}/v1/models`, {
    method: 'GET',
    headers: anthropicHeaders(apiKey, false),
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
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

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
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
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
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
