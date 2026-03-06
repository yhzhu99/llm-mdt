import type {
  ChatCompletionClient,
  ChatCompletionDiagnostics,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionStreamEvent,
  ProviderRequestMode,
  ProviderSettings,
  RequestAttemptDiagnostic,
  RequestMode,
} from '@/types'

interface RequestConfig {
  endpoint: string
  mode: RequestMode
}

interface StreamDiagnosticsAccumulator {
  eventTypes: Set<string>
  reasoningEventCount: number
  contentEventCount: number
  reasoningTextChars: number
  contentTextChars: number
}

interface StreamDiagnosticsContext {
  configuredMode: ProviderRequestMode
  previousAttempts: RequestAttemptDiagnostic[]
  fallbackUsed: boolean
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

  if (preferredType === 'summary_text') {
    const summaryText = normalizeStructuredText(record.summary_text ?? record.summaryText)
    if (summaryText) return [summaryText]
  }

  if (preferredType === 'reasoning_text') {
    const reasoningText = normalizeStructuredText(
      record.reasoning_text ?? record.reasoningText ?? record.reasoning_content ?? record.reasoningContent,
    )
    if (reasoningText) return [reasoningText]
  }

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
  const nestedParts = record.parts != null ? normalizeTextParts(record.parts, preferredType) : []

  return [...nestedSummary, ...nestedContent, ...nestedParts]
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

function createRequestConfigs(baseUrl: string, preferredMode: ProviderRequestMode = 'auto'): RequestConfig[] {
  const orderedModes: RequestMode[] =
    preferredMode === 'auto' ? ['responses', 'chat-completions'] : [preferredMode]
  const candidates = orderedModes.map((mode) => ({ mode, endpoint: resolveEndpoint(baseUrl, mode) }))

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

  const summary = extractSummaryText(
    source.reasoning_summary ??
      source.reasoning_summary_text ??
      source.reasoningSummary ??
      reasoningObject?.summary ??
      reasoningObject?.summary_text ??
      reasoningObject?.summaryText,
  )
  const details = extractDetailedReasoningText(
    source.reasoning_details ??
      source.reasoningDetails ??
      source.thinking ??
      source.reasoning_content ??
      source.reasoningContent ??
      source.reasoning_text ??
      source.reasoningText ??
      source.reasoning_message ??
      (typeof source.reasoning === 'string'
        ? source.reasoning
        : reasoningObject?.content ?? reasoningObject?.details ?? reasoningObject?.text ?? reasoningObject?.reasoning_text),
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

function isReasoningOutputItem(item: Record<string, unknown>) {
  const type = typeof item.type === 'string' ? item.type : ''
  return type === 'reasoning' || type.startsWith('reasoning')
}

function buildResponsesStreamKey(payload: Record<string, unknown>, kind: 'content' | 'reasoning') {
  const item = payload.item && typeof payload.item === 'object' ? (payload.item as Record<string, unknown>) : null
  const itemId =
    normalizeStructuredText(payload.item_id) || normalizeStructuredText(payload.id) || normalizeStructuredText(item?.id) || 'item'
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

  const reasoningItems = output.filter((item) => isReasoningOutputItem(item))
  const summary = joinText(reasoningItems.map((item) => extractSummaryText(item.summary)))
  const details = joinText(reasoningItems.map((item) => extractDetailedReasoningText(item.content)))
  const itemReasoning = mergeReasoningText(summary, details)

  return {
    content,
    reasoning_details: itemReasoning || extractUnifiedReasoningText(data) || null,
  }
}

function createStreamDiagnosticsAccumulator(): StreamDiagnosticsAccumulator {
  return {
    eventTypes: new Set<string>(),
    reasoningEventCount: 0,
    contentEventCount: 0,
    reasoningTextChars: 0,
    contentTextChars: 0,
  }
}

function buildDiagnostics(
  requestConfig: RequestConfig,
  context: StreamDiagnosticsContext,
  state: StreamDiagnosticsAccumulator,
  reasoningDetails: string | null,
  currentStatus: RequestAttemptDiagnostic['status'],
  currentError = '',
): ChatCompletionDiagnostics {
  const currentAttempt: RequestAttemptDiagnostic = {
    mode: requestConfig.mode,
    endpoint: requestConfig.endpoint,
    status: currentStatus,
    ...(currentError ? { error: currentError } : {}),
  }

  return {
    configured_mode: context.configuredMode,
    selected_mode: requestConfig.mode,
    endpoint: requestConfig.endpoint,
    fallback_used: context.fallbackUsed,
    attempts: [...context.previousAttempts, currentAttempt],
    stream_event_types: [...state.eventTypes],
    reasoning_event_count: state.reasoningEventCount,
    content_event_count: state.contentEventCount,
    reasoning_text_chars: state.reasoningTextChars,
    content_text_chars: state.contentTextChars,
    saw_reasoning: state.reasoningEventCount > 0 || state.reasoningTextChars > 0,
    reasoning_details_present: Boolean(String(reasoningDetails || '').trim()),
  }
}

function extractEventText(payload: Record<string, unknown>) {
  const part = payload.part && typeof payload.part === 'object' ? (payload.part as Record<string, unknown>) : null

  return normalizeStructuredText(
    payload.delta ??
      payload.text ??
      payload.reasoning ??
      payload.reasoning_text ??
      payload.reasoning_summary ??
      payload.summary_text ??
      part?.delta ??
      part?.text ??
      part?.summary_text ??
      part?.summary ??
      part?.content,
  )
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
  const requestConfigs = createRequestConfigs(settings.baseUrl, settings.requestMode)
  let lastError: unknown = null
  const attempts: RequestAttemptDiagnostic[] = []

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: false }),
        timeoutMs,
      )
      const data = (await response.json()) as Record<string, unknown>
      const parsed = parseJsonResult(requestConfig, data)
      const successAttempt: RequestAttemptDiagnostic = {
        mode: requestConfig.mode,
        endpoint: requestConfig.endpoint,
        status: 'succeeded',
      }
      return {
        ...parsed,
        diagnostics: {
          configured_mode: settings.requestMode || 'auto',
          selected_mode: requestConfig.mode,
          endpoint: requestConfig.endpoint,
          fallback_used: index > 0,
          attempts: [...attempts, successAttempt],
          stream_event_types: [],
          reasoning_event_count: parsed.reasoning_details ? 1 : 0,
          content_event_count: parsed.content ? 1 : 0,
          reasoning_text_chars: parsed.reasoning_details?.length || 0,
          content_text_chars: parsed.content.length,
          saw_reasoning: Boolean(parsed.reasoning_details),
          reasoning_details_present: Boolean(parsed.reasoning_details),
        },
      }
    } catch (error) {
      lastError = error
      attempts.push({
        mode: requestConfig.mode,
        endpoint: requestConfig.endpoint,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
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
      raw_type: type,
    }
  }

  if (type === 'response.output_text.done') {
    return {
      delta_type: 'content' as const,
      text: normalizeStructuredText(payload.text),
      stream_key: buildResponsesStreamKey(payload, 'content'),
      is_done: true,
      raw_type: type,
    }
  }

  if (
    type === 'response.reasoning_summary_part.added' ||
    (type.startsWith('response.reasoning') && (type.endsWith('.delta') || type.endsWith('.added')))
  ) {
    return {
      delta_type: 'reasoning' as const,
      text: extractEventText(payload),
      stream_key: buildResponsesStreamKey(payload, 'reasoning'),
      is_done: false,
      raw_type: type,
    }
  }

  if (
    type === 'response.reasoning_summary_part.done' ||
    (type.startsWith('response.reasoning') && type.endsWith('.done'))
  ) {
    return {
      delta_type: 'reasoning' as const,
      text: extractEventText(payload),
      stream_key: buildResponsesStreamKey(payload, 'reasoning'),
      is_done: true,
      raw_type: type,
    }
  }

  if ((type === 'response.output_item.added' || type === 'response.output_item.done') && payload.item && typeof payload.item === 'object') {
    const item = payload.item as Record<string, unknown>
    if (isReasoningOutputItem(item)) {
      return {
        delta_type: 'reasoning' as const,
        text: extractUnifiedReasoningText(item),
        stream_key: buildResponsesStreamKey({ ...payload, item_id: item.id ?? payload.item_id }, 'reasoning'),
        is_done: type === 'response.output_item.done',
        raw_type: type,
      }
    }
  }

  if (type === 'response.output_item.done' && payload.item && typeof payload.item === 'object') {
    const item = payload.item as Record<string, unknown>
    if (isReasoningOutputItem(item)) {
      return {
        delta_type: 'final' as const,
        content: '',
        reasoning_details: extractUnifiedReasoningText(item) || null,
        raw_type: type,
      }
    }
  }

  if (type === 'response.completed' && payload.response && typeof payload.response === 'object') {
    const parsed = parseResponsesResult(payload.response as Record<string, unknown>)
    return {
      delta_type: 'final' as const,
      content: parsed.content,
      reasoning_details: parsed.reasoning_details,
      raw_type: type,
    }
  }

  if (type === 'error') {
    const error = payload.error
    const message =
      (error && typeof error === 'object' ? normalizeStructuredText((error as Record<string, unknown>).message) : '') ||
      normalizeStructuredText(payload.message) ||
      'Unknown error'
    return { delta_type: 'error' as const, message, raw_type: type }
  }

  return null
}

async function* streamFromResponse(
  requestConfig: RequestConfig,
  response: Response,
  context: StreamDiagnosticsContext,
): AsyncGenerator<ChatCompletionStreamEvent> {
  let contentAcc = ''
  let reasoningAcc = ''
  let reasoningDetails: string | null = null
  const contentBuffers = new Map<string, string>()
  const reasoningBuffers = new Map<string, string>()
  const diagnostics = createStreamDiagnosticsAccumulator()

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as Record<string, unknown>
    const parsed = parseJsonResult(requestConfig, data)
    yield {
      delta_type: 'final',
      content: parsed.content,
      reasoning_details: parsed.reasoning_details,
      diagnostics: buildDiagnostics(
        requestConfig,
        context,
        diagnostics,
        parsed.reasoning_details,
        'succeeded',
      ),
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
          const payloadType = typeof payload.type === 'string' ? payload.type : ''
          if (payloadType) diagnostics.eventTypes.add(payloadType)
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
              diagnostics.contentEventCount += 1
              diagnostics.contentTextChars += nextText.length
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
              diagnostics.reasoningEventCount += 1
              diagnostics.reasoningTextChars += nextText.length
              yield { delta_type: 'reasoning', text: nextText }
            }
          } else if (parsedEvent.delta_type === 'final') {
            reasoningDetails = parsedEvent.reasoning_details || reasoningDetails
            if (!contentAcc && parsedEvent.content) {
              contentAcc = parsedEvent.content
            }
          } else if (parsedEvent.delta_type === 'error') {
            yield {
              ...parsedEvent,
              diagnostics: buildDiagnostics(
                requestConfig,
                context,
                diagnostics,
                reasoningDetails || reasoningAcc || null,
                'failed',
                parsedEvent.message,
              ),
            }
            return
          }

          continue
        }

        diagnostics.eventTypes.add('chat.completions.chunk')
        const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0]
        if (!choice) continue

        const delta = (choice.delta as Record<string, unknown> | undefined) ?? {}
        const message = extractChoiceMessage(choice)

        const contentDelta = normalizeStructuredText(delta.content)
        if (contentDelta) {
          contentAcc += contentDelta
          diagnostics.contentEventCount += 1
          diagnostics.contentTextChars += contentDelta.length
          yield { delta_type: 'content', text: contentDelta }
        }

        const reasoningDelta = extractReasoningDelta(delta)
        if (reasoningDelta) {
          reasoningAcc += reasoningDelta
          diagnostics.reasoningEventCount += 1
          diagnostics.reasoningTextChars += reasoningDelta.length
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
    diagnostics: buildDiagnostics(
      requestConfig,
      context,
      diagnostics,
      reasoningDetails || reasoningAcc || null,
      'succeeded',
    ),
  }
}

export async function* chatCompletionStream(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const requestConfigs = createRequestConfigs(settings.baseUrl, settings.requestMode)
  let lastError: unknown = null
  const attempts: RequestAttemptDiagnostic[] = []

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: true }),
        timeoutMs,
      )

      for await (const event of streamFromResponse(requestConfig, response, {
        configuredMode: settings.requestMode || 'auto',
        previousAttempts: attempts,
        fallbackUsed: index > 0,
      })) {
        yield event
      }
      return
    } catch (error) {
      lastError = error
      attempts.push({
        mode: requestConfig.mode,
        endpoint: requestConfig.endpoint,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      if (shouldFallbackToNextAttempt(error, index < requestConfigs.length - 1)) {
        continue
      }

      yield {
        delta_type: 'error',
        message: error instanceof Error ? error.message : String(error),
        diagnostics: {
          configured_mode: settings.requestMode || 'auto',
          selected_mode: requestConfig.mode,
          endpoint: requestConfig.endpoint,
          fallback_used: index > 0,
          attempts,
          stream_event_types: [],
          reasoning_event_count: 0,
          content_event_count: 0,
          reasoning_text_chars: 0,
          content_text_chars: 0,
          saw_reasoning: false,
          reasoning_details_present: false,
        },
      }
      return
    }
  }

  yield {
    delta_type: 'error',
    message: lastError instanceof Error ? lastError.message : String(lastError || 'Request failed'),
    diagnostics: {
      configured_mode: settings.requestMode || 'auto',
      selected_mode: requestConfigs[requestConfigs.length - 1]?.mode || null,
      endpoint: requestConfigs[requestConfigs.length - 1]?.endpoint || '',
      fallback_used: requestConfigs.length > 1,
      attempts,
      stream_event_types: [],
      reasoning_event_count: 0,
      content_event_count: 0,
      reasoning_text_chars: 0,
      content_text_chars: 0,
      saw_reasoning: false,
      reasoning_details_present: false,
    },
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
