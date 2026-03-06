import type {
  ChatCompletionClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionStreamEvent,
  ProviderSettings,
  ReasoningVisibility,
} from '@/types'

type ProviderKind = 'openai' | 'zenmux' | 'generic'
type RequestMode = 'chat-completions' | 'responses'
type ModelFamily = 'openai-reasoning' | 'gemini' | 'deepseek-reasoner' | 'unknown'

interface RequestConfig {
  endpoint: string
  mode: RequestMode
  provider: ProviderKind
  modelFamily: ModelFamily
  reasoningEffort: string | null
  reasoningSummaryMode: string | null
}

interface ReasoningFields {
  reasoning_details: string | null
  reasoning_summary: string | null
  reasoning_visibility: ReasoningVisibility
}

function createRequestError(message: string) {
  return new Error(message)
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

function createReasoningFields(summary: string, details: string): ReasoningFields {
  const normalizedSummary = summary.trim() || null
  const normalizedDetails = details.trim() || null

  return {
    reasoning_summary: normalizedSummary,
    reasoning_details: normalizedDetails,
    reasoning_visibility: normalizedSummary ? 'summary' : normalizedDetails ? 'details' : 'none',
  }
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

function getProviderKind(baseUrl: string): ProviderKind {
  try {
    const host = new URL(baseUrl).host.toLowerCase()
    if (host === 'api.openai.com' || host.endsWith('.openai.com')) return 'openai'
    if (host === 'zenmux.ai' || host.endsWith('.zenmux.ai')) return 'zenmux'
  } catch {
    return 'generic'
  }

  return 'generic'
}

function normalizeModelName(model: string) {
  const normalized = String(model || '').trim().toLowerCase()
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

function getModelFamily(model: string): ModelFamily {
  const normalized = normalizeModelName(model)

  if (
    normalized.startsWith('gpt-5') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai-reasoning'
  }

  if (normalized.includes('gemini')) {
    return 'gemini'
  }

  if (normalized.includes('deepseek-reasoner')) {
    return 'deepseek-reasoner'
  }

  return 'unknown'
}

function supportsResponsesApi(provider: ProviderKind, modelFamily: ModelFamily) {
  if (provider === 'openai') return modelFamily === 'openai-reasoning'
  if (provider === 'zenmux') return modelFamily === 'openai-reasoning' || modelFamily === 'gemini'
  return false
}

function selectReasoningEffort(provider: ProviderKind, model: string, modelFamily: ModelFamily) {
  if (provider === 'openai' && modelFamily === 'openai-reasoning') {
    const normalized = normalizeModelName(model)
    if (/^gpt-5\.(2|3|4)(?:$|-)/.test(normalized)) {
      return 'xhigh'
    }
    return 'high'
  }

  if (provider === 'zenmux' && (modelFamily === 'openai-reasoning' || modelFamily === 'gemini')) {
    return 'high'
  }

  return null
}

function selectReasoningSummaryMode(provider: ProviderKind, mode: RequestMode) {
  if (mode !== 'responses') return null
  if (provider === 'openai') return 'auto'
  if (provider === 'zenmux') return 'detailed'
  return null
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

function resolveRequestConfig(settings: ProviderSettings, model: string): RequestConfig {
  const provider = getProviderKind(settings.baseUrl)
  const modelFamily = getModelFamily(model)
  const mode: RequestMode = supportsResponsesApi(provider, modelFamily) ? 'responses' : 'chat-completions'

  return {
    endpoint: resolveEndpoint(settings.baseUrl, mode),
    mode,
    provider,
    modelFamily,
    reasoningEffort: selectReasoningEffort(provider, model, modelFamily),
    reasoningSummaryMode: selectReasoningSummaryMode(provider, mode),
  }
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
    }

    if (stream) {
      payload.stream = true
    }

    if (requestConfig.reasoningEffort || requestConfig.reasoningSummaryMode) {
      payload.reasoning = {
        ...(requestConfig.reasoningEffort ? { effort: requestConfig.reasoningEffort } : {}),
        ...(requestConfig.reasoningSummaryMode ? { summary: requestConfig.reasoningSummaryMode } : {}),
      }
    }

    return payload
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
  }

  if (stream) {
    payload.stream = true
  }

  if (requestConfig.reasoningEffort) {
    payload.reasoning_effort = requestConfig.reasoningEffort
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

function extractChatReasoningFields(source: Record<string, unknown>): ReasoningFields {
  const reasoningObject =
    source.reasoning && typeof source.reasoning === 'object' ? (source.reasoning as Record<string, unknown>) : null

  const summary = extractSummaryText(source.reasoning_summary ?? reasoningObject?.summary)
  const details = extractDetailedReasoningText(
    source.reasoning_details ??
      source.thinking ??
      source.reasoning_content ??
      (typeof source.reasoning === 'string' ? source.reasoning : reasoningObject?.content),
  )

  return createReasoningFields(summary, details)
}

function extractReasoningDelta(delta: Record<string, unknown>) {
  const reasoningObject =
    delta.reasoning && typeof delta.reasoning === 'object' ? (delta.reasoning as Record<string, unknown>) : null

  return (
    extractSummaryText(delta.reasoning_summary ?? reasoningObject?.summary) ||
    extractDetailedReasoningText(
      delta.reasoning_details ??
        delta.thinking ??
        delta.reasoning_content ??
        (typeof delta.reasoning === 'string' ? delta.reasoning : reasoningObject?.content),
    )
  )
}

function extractChoiceMessage(choice: Record<string, unknown>) {
  return (choice.message as Record<string, unknown> | undefined) ?? {}
}

function buildChatResponseObject(message: Record<string, unknown>, fallbackReasoning = ''): ChatCompletionResult {
  const reasoning = extractChatReasoningFields(message)
  const fallbackDetails = reasoning.reasoning_details || fallbackReasoning || null

  return {
    content: normalizeStructuredText(message.content),
    reasoning_details: fallbackDetails,
    reasoning_summary: reasoning.reasoning_summary,
    reasoning_visibility: reasoning.reasoning_summary ? 'summary' : fallbackDetails ? 'details' : 'none',
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

function parseResponsesResult(data: Record<string, unknown>): ChatCompletionResult {
  const output = Array.isArray(data.output) ? (data.output as Array<Record<string, unknown>>) : []

  const content =
    normalizeStructuredText(data.output_text) ||
    output.map((item) => extractResponseOutputText(item)).filter(Boolean).join('')

  const reasoningItems = output.filter((item) => item.type === 'reasoning')
  const summary = joinText(reasoningItems.map((item) => extractSummaryText(item.summary)))
  const details = joinText(reasoningItems.map((item) => extractDetailedReasoningText(item.content)))
  const reasoning = createReasoningFields(summary, details)

  return {
    content,
    ...reasoning,
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
      throw createRequestError(await readErrorBody(response))
    }

    return response
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function chatCompletion(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
) {
  const requestConfig = resolveRequestConfig(settings, model)
  const response = await doFetch(requestConfig.endpoint, settings, buildPayload(requestConfig, { model, messages, stream: false }), timeoutMs)
  const data = (await response.json()) as {
    choices?: Array<{ message?: Record<string, unknown> }>
    output?: unknown[]
    output_text?: unknown
  }

  if (requestConfig.mode === 'responses') {
    return parseResponsesResult(data as Record<string, unknown>)
  }

  const message = data.choices?.[0]?.message ?? {}
  return buildChatResponseObject(message)
}

function extractResponsesEventDelta(payload: Record<string, unknown>) {
  const type = typeof payload.type === 'string' ? payload.type : ''

  if (type === 'response.output_text.delta') {
    return { delta_type: 'content' as const, text: normalizeStructuredText(payload.delta) }
  }

  if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
    return {
      delta_type: 'reasoning' as const,
      text: normalizeStructuredText(payload.delta),
      reasoning_kind: type === 'response.reasoning_summary_text.delta' ? ('summary' as const) : ('details' as const),
    }
  }

  if (type === 'response.completed' && payload.response && typeof payload.response === 'object') {
    const parsed = parseResponsesResult(payload.response as Record<string, unknown>)
    return {
      delta_type: 'final' as const,
      content: parsed.content,
      reasoning_details: parsed.reasoning_details,
      reasoning_summary: parsed.reasoning_summary,
      reasoning_visibility: parsed.reasoning_visibility,
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

export async function* chatCompletionStream(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const requestConfig = resolveRequestConfig(settings, model)
  let contentAcc = ''
  let reasoningAcc = ''
  let reasoningDetails: string | null = null
  let reasoningSummary: string | null = null
  let reasoningVisibility: ReasoningVisibility = 'none'

  try {
    const response = await doFetch(
      requestConfig.endpoint,
      settings,
      buildPayload(requestConfig, { model, messages, stream: true }),
      timeoutMs,
    )

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: Record<string, unknown> }>
        output?: unknown[]
        output_text?: unknown
      }

      const parsed =
        requestConfig.mode === 'responses'
          ? parseResponsesResult(data as Record<string, unknown>)
          : buildChatResponseObject(data.choices?.[0]?.message ?? {})

      yield {
        delta_type: 'final',
        content: parsed.content,
        reasoning_details: parsed.reasoning_details,
        reasoning_summary: parsed.reasoning_summary,
        reasoning_visibility: parsed.reasoning_visibility,
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
              contentAcc += parsedEvent.text
              yield parsedEvent
            } else if (parsedEvent.delta_type === 'reasoning') {
              reasoningAcc += parsedEvent.text
              reasoningVisibility =
                parsedEvent.reasoning_kind === 'summary'
                  ? 'summary'
                  : reasoningVisibility === 'summary'
                    ? 'summary'
                    : 'details'
              yield parsedEvent
            } else if (parsedEvent.delta_type === 'final') {
              reasoningDetails = parsedEvent.reasoning_details
              reasoningSummary = parsedEvent.reasoning_summary || null
              reasoningVisibility = parsedEvent.reasoning_visibility || 'none'
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

          const finalReasoning = extractChatReasoningFields(message)
          if (finalReasoning.reasoning_details) {
            reasoningDetails = finalReasoning.reasoning_details
          }
          if (finalReasoning.reasoning_summary) {
            reasoningSummary = finalReasoning.reasoning_summary
          }
          if (finalReasoning.reasoning_visibility !== 'none') {
            reasoningVisibility = finalReasoning.reasoning_visibility
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
  } catch (error) {
    yield {
      delta_type: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
    return
  }

  yield {
    delta_type: 'final',
    content: contentAcc,
    reasoning_details: reasoningDetails || (reasoningVisibility === 'details' ? reasoningAcc || null : null),
    reasoning_summary: reasoningSummary || (reasoningVisibility === 'summary' ? reasoningAcc || null : null),
    reasoning_visibility:
      reasoningVisibility !== 'none'
        ? reasoningVisibility
        : reasoningSummary
          ? 'summary'
          : reasoningDetails || reasoningAcc
            ? 'details'
            : 'none',
  }
}

export const __private__ = {
  buildHeaders,
  buildPayload,
  buildChatResponseObject,
  extractPayloadsFromBlock,
  extractReasoningDelta,
  extractResponsesEventDelta,
  getModelFamily,
  normalizeStructuredText,
  normalizeReasoningValue,
  parseResponsesResult,
  resolveEndpoint,
  resolveRequestConfig,
}

export const llmClient: ChatCompletionClient = {
  chatCompletion,
  chatCompletionStream,
}
