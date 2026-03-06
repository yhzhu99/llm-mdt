import type {
  ChatCompletionClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionStreamEvent,
  ProviderSettings,
} from '@/types'

type RequestMode = 'responses' | 'chat-completions'

interface RequestConfig {
  endpoint: string
  mode: RequestMode
}

class RequestError extends Error {
  status: number
  body: string

  constructor(message: string, status = 0, body = '') {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.body = body
  }
}

const DEFAULT_REASONING_EFFORT = 'high'
const DEFAULT_REASONING_SUMMARY = 'detailed'

function createRequestError(message: string, status = 0, body = '') {
  return new RequestError(message, status, body)
}

function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError
}

function normalizeStructuredText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStructuredText(item)).join('')
  }

  if (typeof value === 'object') {
    const structured = value as { text?: unknown; content?: unknown }
    if (typeof structured.text === 'string') return structured.text
    if (typeof structured.content === 'string') return structured.content
    if (Array.isArray(structured.content)) return normalizeStructuredText(structured.content)
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

function joinText(parts: string[], separator = '\n\n') {
  return parts.map((part) => part.trim()).filter(Boolean).join(separator)
}

function normalizeTextParts(value: unknown, preferredType?: 'summary_text' | 'reasoning_text'): string[] {
  if (value == null) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeTextParts(item, preferredType))
  }

  if (typeof value !== 'object') {
    return []
  }

  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''

  if (preferredType && type && type !== preferredType) {
    if (preferredType === 'summary_text' && record.summary != null) {
      return normalizeTextParts(record.summary, preferredType)
    }
    if (preferredType === 'reasoning_text' && record.content != null) {
      return normalizeTextParts(record.content, preferredType)
    }
  }

  if (!preferredType || !type || type === preferredType) {
    const text = normalizeStructuredText(record.text)
    if (text) {
      return [text]
    }
  }

  const nestedContent = record.content != null ? normalizeTextParts(record.content, preferredType) : []
  const nestedSummary = record.summary != null ? normalizeTextParts(record.summary, preferredType) : []

  return [...nestedSummary, ...nestedContent]
}

function extractSummaryText(value: unknown) {
  return joinText(normalizeTextParts(value, 'summary_text'))
}

function extractDetailedReasoningText(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  const typedParts = normalizeTextParts(value, 'reasoning_text')
  if (typedParts.length > 0) {
    return joinText(typedParts)
  }

  if (Array.isArray(value)) {
    return joinText(value.map((item) => normalizeStructuredText(item)))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.content != null) {
      const contentText = normalizeStructuredText(record.content)
      if (contentText) return contentText
    }
    if (record.text != null) {
      const text = normalizeStructuredText(record.text)
      if (text) return text
    }
  }

  return ''
}

function mergeReasoningText(summary: string, details: string) {
  const normalizedDetails = details.trim()
  if (normalizedDetails) return normalizedDetails

  const normalizedSummary = summary.trim()
  return normalizedSummary || ''
}

function normalizeReasoningValue(value: unknown) {
  return extractDetailedReasoningText(value)
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) {
    return `${response.status} ${response.statusText}`.trim()
  }

  try {
    const data = JSON.parse(text) as {
      error?: { message?: string } | string
      message?: string
      detail?: string
    }
    const message =
      (typeof data.error === 'object' ? data.error?.message : data.error) ||
      data.message ||
      data.detail ||
      `${response.status} ${response.statusText}`.trim()
    return `${message}`
  } catch {
    return text
  }
}

function buildHeaders(settings: ProviderSettings) {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function resolveEndpoint(baseUrl: string, mode: RequestMode) {
  const trimmed = trimTrailingSlash(String(baseUrl || '').trim())

  if (!trimmed) return ''

  if (mode === 'responses') {
    if (trimmed.endsWith('/responses')) return trimmed
    if (trimmed.endsWith('/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/responses')
    return `${trimmed}/responses`
  }

  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/responses')) return trimmed.replace(/\/responses$/, '/chat/completions')
  return `${trimmed}/chat/completions`
}

function createRequestConfigs(baseUrl: string): RequestConfig[] {
  const candidates: RequestConfig[] = [
    { mode: 'responses', endpoint: resolveEndpoint(baseUrl, 'responses') },
    { mode: 'chat-completions', endpoint: resolveEndpoint(baseUrl, 'chat-completions') },
  ]

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.mode}:${candidate.endpoint}`
    if (!candidate.endpoint || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildResponsesInput(messages: ChatCompletionOptions['messages']) {
  return messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: 'input_text',
        text: message.content,
      },
    ],
  }))
}

function buildPayload(
  requestConfig: RequestConfig,
  { model, messages, stream }: ChatCompletionOptions & { stream: boolean },
) {
  if (requestConfig.mode === 'responses') {
    const payload: Record<string, unknown> = {
      model,
      input: buildResponsesInput(messages),
      reasoning: {
        effort: DEFAULT_REASONING_EFFORT,
        summary: DEFAULT_REASONING_SUMMARY,
      },
    }

    if (stream) {
      payload.stream = true
    }

    return payload
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    reasoning_effort: DEFAULT_REASONING_EFFORT,
  }

  if (stream) {
    payload.stream = true
  }

  return payload
}

function extractPayloadsFromBlock(block: string) {
  const lines = block.split(/\r?\n/)
  const dataLines = lines
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length > 0) {
    return [dataLines.join('\n').trim()].filter(Boolean)
  }

  const trimmed = block.trim()
  return trimmed ? [trimmed] : []
}

function extractUnifiedReasoningText(source: Record<string, unknown>) {
  const reasoningObject =
    source.reasoning && typeof source.reasoning === 'object' ? (source.reasoning as Record<string, unknown>) : null

  const summary = extractSummaryText(source.reasoning_summary ?? reasoningObject?.summary)
  const details = extractDetailedReasoningText(
    source.reasoning_details ??
      source.thinking ??
      source.reasoning_content ??
      (typeof source.reasoning === 'string' ? source.reasoning : reasoningObject?.content),
  )

  return mergeReasoningText(summary, details)
}

function extractReasoningDelta(delta: Record<string, unknown>) {
  return extractUnifiedReasoningText(delta)
}

function extractChoiceMessage(choice: Record<string, unknown>) {
  return (choice.message as Record<string, unknown> | undefined) ?? {}
}

function buildChatResponseObject(message: Record<string, unknown>, fallbackReasoning = ''): ChatCompletionResult {
  return {
    content: normalizeStructuredText(message.content),
    reasoning_details: extractUnifiedReasoningText(message) || fallbackReasoning || null,
  }
}

function extractResponseOutputText(item: Record<string, unknown>) {
  if (item.type === 'message') {
    return normalizeStructuredText(item.content)
  }

  if (item.type === 'output_text') {
    return normalizeStructuredText(item.text)
  }

  return ''
}

function buildResponsesStreamKey(payload: Record<string, unknown>, kind: 'content' | 'reasoning') {
  const itemId = normalizeStructuredText(payload.item_id) || normalizeStructuredText(payload.id) || 'item'
  const outputIndex = normalizeStructuredText(payload.output_index) || '0'
  const contentIndex =
    kind === 'content'
      ? normalizeStructuredText(payload.content_index)
      : normalizeStructuredText(payload.summary_index) || normalizeStructuredText(payload.content_index)

  return `${kind}:${outputIndex}:${itemId}:${contentIndex || '0'}`
}

function takeStreamRemainder(fullText: string, previousText: string) {
  if (!fullText) return ''
  if (!previousText) return fullText
  if (fullText === previousText) return ''
  if (fullText.startsWith(previousText)) return fullText.slice(previousText.length)
  return fullText
}

function parseResponsesResult(data: Record<string, unknown>): ChatCompletionResult {
  const output = Array.isArray(data.output) ? (data.output as Array<Record<string, unknown>>) : []

  const content =
    normalizeStructuredText(data.output_text) ||
    output.map((item) => extractResponseOutputText(item)).filter(Boolean).join('')

  const reasoningItems = output.filter((item) => item.type === 'reasoning')
  const summary = joinText(reasoningItems.map((item) => extractSummaryText(item.summary)))
  const details = joinText(reasoningItems.map((item) => extractDetailedReasoningText(item.content)))

  return {
    content,
    reasoning_details: mergeReasoningText(summary, details) || null,
  }
}

async function doFetch(url: string, settings: ProviderSettings, payload: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorBody = await readErrorBody(response)
      throw createRequestError(errorBody, response.status, errorBody)
    }

    return response
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function shouldFallbackToNextAttempt(error: unknown, hasNextAttempt: boolean) {
  if (!hasNextAttempt) return false
  if (!isRequestError(error)) return false

  if ([400, 404, 405, 415, 422, 501].includes(error.status)) {
    return true
  }

  const body = `${error.message}\n${error.body}`.toLowerCase()
  return [
    'responses',
    'chat/completions',
    'unsupported',
    'unknown parameter',
    'unknown field',
    'unrecognized',
    'not found',
    'invalid input',
  ].some((pattern) => body.includes(pattern))
}

function parseJsonResult(requestConfig: RequestConfig, data: Record<string, unknown>) {
  if (requestConfig.mode === 'responses') {
    return parseResponsesResult(data)
  }

  const message = ((data.choices as Array<{ message?: Record<string, unknown> }> | undefined) || [])[0]?.message ?? {}
  return buildChatResponseObject(message)
}

export async function chatCompletion(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
) {
  const requestConfigs = createRequestConfigs(settings.baseUrl)
  let lastError: unknown = null

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: false }),
        timeoutMs,
      )
      const data = (await response.json()) as Record<string, unknown>
      return parseJsonResult(requestConfig, data)
    } catch (error) {
      lastError = error
      if (shouldFallbackToNextAttempt(error, index < requestConfigs.length - 1)) {
        continue
      }
      throw error
    }
  }

  throw (lastError instanceof Error ? lastError : createRequestError('Request failed'))
}

function extractResponsesEventDelta(payload: Record<string, unknown>) {
  const type = typeof payload.type === 'string' ? payload.type : ''

  if (type === 'response.output_text.delta') {
    return {
      delta_type: 'content' as const,
      text: normalizeStructuredText(payload.delta),
      stream_key: buildResponsesStreamKey(payload, 'content'),
      is_done: false,
    }
  }

  if (type === 'response.output_text.done') {
    return {
      delta_type: 'content' as const,
      text: normalizeStructuredText(payload.text),
      stream_key: buildResponsesStreamKey(payload, 'content'),
      is_done: true,
    }
  }

  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_part.added'
  ) {
    return {
      delta_type: 'reasoning' as const,
      text: normalizeStructuredText(payload.delta ?? (payload.part as Record<string, unknown> | undefined)?.text),
      stream_key: buildResponsesStreamKey(payload, 'reasoning'),
      is_done: false,
    }
  }

  if (
    type === 'response.reasoning_summary_text.done' ||
    type === 'response.reasoning_text.done' ||
    type === 'response.reasoning_summary_part.done'
  ) {
    return {
      delta_type: 'reasoning' as const,
      text: normalizeStructuredText(payload.text ?? (payload.part as Record<string, unknown> | undefined)?.text),
      stream_key: buildResponsesStreamKey(payload, 'reasoning'),
      is_done: true,
    }
  }

  if (type === 'response.output_item.done' && payload.item && typeof payload.item === 'object') {
    const item = payload.item as Record<string, unknown>
    if (item.type === 'reasoning') {
      return {
        delta_type: 'final' as const,
        content: '',
        reasoning_details: extractUnifiedReasoningText(item) || null,
      }
    }
  }

  if (type === 'response.completed' && payload.response && typeof payload.response === 'object') {
    const parsed = parseResponsesResult(payload.response as Record<string, unknown>)
    return {
      delta_type: 'final' as const,
      content: parsed.content,
      reasoning_details: parsed.reasoning_details,
    }
  }

  if (type === 'error') {
    const error = payload.error
    const message =
      (error && typeof error === 'object' ? normalizeStructuredText((error as Record<string, unknown>).message) : '') ||
      normalizeStructuredText(payload.message) ||
      'Unknown error'
    return { delta_type: 'error' as const, message }
  }

  return null
}

async function* streamFromResponse(
  requestConfig: RequestConfig,
  response: Response,
): AsyncGenerator<ChatCompletionStreamEvent> {
  let contentAcc = ''
  let reasoningAcc = ''
  let reasoningDetails: string | null = null
  const contentBuffers = new Map<string, string>()
  const reasoningBuffers = new Map<string, string>()

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as Record<string, unknown>
    const parsed = parseJsonResult(requestConfig, data)
    yield {
      delta_type: 'final',
      content: parsed.content,
      reasoning_details: parsed.reasoning_details,
    }
    return
  }

  if (!response.body) {
    throw createRequestError('Streaming response body is empty')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let isDone = false

  while (!isDone) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      for (const payloadText of extractPayloadsFromBlock(part)) {
        if (payloadText === '[DONE]') {
          isDone = true
          break
        }

        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(payloadText) as Record<string, unknown>
        } catch {
          continue
        }

        if (requestConfig.mode === 'responses') {
          const parsedEvent = extractResponsesEventDelta(payload)
          if (!parsedEvent) continue

          if (parsedEvent.delta_type === 'content') {
            const nextText =
              parsedEvent.is_done && parsedEvent.stream_key
                ? takeStreamRemainder(parsedEvent.text, contentBuffers.get(parsedEvent.stream_key) || '')
                : parsedEvent.text

            if (parsedEvent.stream_key) {
              contentBuffers.set(
                parsedEvent.stream_key,
                parsedEvent.is_done
                  ? parsedEvent.text || contentBuffers.get(parsedEvent.stream_key) || ''
                  : `${contentBuffers.get(parsedEvent.stream_key) || ''}${parsedEvent.text}`,
              )
            }

            if (nextText) {
              contentAcc += nextText
              yield { delta_type: 'content', text: nextText }
            }
          } else if (parsedEvent.delta_type === 'reasoning') {
            const nextText =
              parsedEvent.is_done && parsedEvent.stream_key
                ? takeStreamRemainder(parsedEvent.text, reasoningBuffers.get(parsedEvent.stream_key) || '')
                : parsedEvent.text

            if (parsedEvent.stream_key) {
              reasoningBuffers.set(
                parsedEvent.stream_key,
                parsedEvent.is_done
                  ? parsedEvent.text || reasoningBuffers.get(parsedEvent.stream_key) || ''
                  : `${reasoningBuffers.get(parsedEvent.stream_key) || ''}${parsedEvent.text}`,
              )
            }

            if (nextText) {
              reasoningAcc += nextText
              yield { delta_type: 'reasoning', text: nextText }
            }
          } else if (parsedEvent.delta_type === 'final') {
            reasoningDetails = parsedEvent.reasoning_details || reasoningDetails
            if (!contentAcc && parsedEvent.content) {
              contentAcc = parsedEvent.content
            }
          } else if (parsedEvent.delta_type === 'error') {
            yield parsedEvent
            return
          }

          continue
        }

        const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0]
        if (!choice) continue

        const delta = (choice.delta as Record<string, unknown> | undefined) ?? {}
        const message = extractChoiceMessage(choice)

        const contentDelta = normalizeStructuredText(delta.content)
        if (contentDelta) {
          contentAcc += contentDelta
          yield { delta_type: 'content', text: contentDelta }
        }

        const reasoningDelta = extractReasoningDelta(delta)
        if (reasoningDelta) {
          reasoningAcc += reasoningDelta
          yield { delta_type: 'reasoning', text: reasoningDelta }
        }

        const finalReasoning = extractUnifiedReasoningText(message)
        if (finalReasoning) {
          reasoningDetails = finalReasoning
        }

        if (!contentDelta) {
          const fullContent = normalizeStructuredText(message.content)
          if (fullContent && !contentAcc) {
            contentAcc = fullContent
          }
        }
      }
    }
  }

  yield {
    delta_type: 'final',
    content: contentAcc,
    reasoning_details: reasoningDetails || reasoningAcc || null,
  }
}

export async function* chatCompletionStream(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const requestConfigs = createRequestConfigs(settings.baseUrl)
  let lastError: unknown = null

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: true }),
        timeoutMs,
      )

      for await (const event of streamFromResponse(requestConfig, response)) {
        yield event
      }
      return
    } catch (error) {
      lastError = error
      if (shouldFallbackToNextAttempt(error, index < requestConfigs.length - 1)) {
        continue
      }

      yield {
        delta_type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
      return
    }
  }

  yield {
    delta_type: 'error',
    message: lastError instanceof Error ? lastError.message : String(lastError || 'Request failed'),
  }
}

export const __private__ = {
  buildHeaders,
  buildPayload,
  buildChatResponseObject,
  createRequestConfigs,
  extractPayloadsFromBlock,
  extractReasoningDelta,
  extractResponsesEventDelta,
  mergeReasoningText,
  normalizeStructuredText,
  normalizeReasoningValue,
  parseResponsesResult,
  resolveEndpoint,
  shouldFallbackToNextAttempt,
}

export const llmClient: ChatCompletionClient = {
  chatCompletion,
  chatCompletionStream,
}
