import Anthropic from '@anthropic-ai/sdk'
import type {
  ChatCompletionClient,
  ChatCompletionDiagnostics,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionStreamEvent,
  ProviderRequestMode,
  ProviderSettings,
  ResolvedRequestMode,
  RequestAttemptDiagnostic,
  RequestMode,
} from '@/types'
import { isAbortError, joinReasoningText, normalizeReasoningFragment, normalizeReasoningText, pickBestReasoningText } from '@/utils'

interface RequestConfig {
  endpoint: string
  mode: RequestMode
}

interface AnthropicRequestConfig {
  endpoint: string
  mode: 'anthropic-messages'
}

type RuntimeRequestConfig = RequestConfig | AnthropicRequestConfig

interface AnthropicContentBlockLike {
  type?: string
  text?: string
  thinking?: string
}

interface AnthropicStreamDeltaLike {
  type?: string
  text?: string
  thinking?: string
}

interface AnthropicStreamEventLike {
  type?: string
  index?: number
  content_block?: AnthropicContentBlockLike
  delta?: AnthropicStreamDeltaLike
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
const DEFAULT_REASONING_SUMMARY = 'auto'
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000
const DEFAULT_ANTHROPIC_THINKING_BUDGET = 10000
const ANTHROPIC_REQUEST_MODE = 'anthropic-messages' as const
const ZENMUX_ANTHROPIC_PATH = '/api/anthropic'
const anthropicClientCache = new Map<string, Anthropic>()

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
    const text = preferredType ? normalizeReasoningFragment(String(value)) : String(value)
    return text ? [text] : []
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
    for (const value of [
      normalizeStructuredText(record.summary_text),
      normalizeStructuredText(record.summaryText),
      type === 'summary_text' ? normalizeStructuredText(record.text) : '',
    ]) {
      const summaryText = normalizeReasoningFragment(value)
      if (summaryText) return [summaryText]
    }
  }

  if (preferredType === 'reasoning_text') {
    for (const value of [
      normalizeStructuredText(record.reasoning_text),
      normalizeStructuredText(record.reasoningText),
      normalizeStructuredText(record.reasoning_content),
      normalizeStructuredText(record.reasoningContent),
      type === 'reasoning_text' ? normalizeStructuredText(record.text) : '',
    ]) {
      const reasoningText = normalizeReasoningFragment(value)
      if (reasoningText) return [reasoningText]
    }
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
    const text = preferredType ? normalizeReasoningFragment(normalizeStructuredText(record.text)) : normalizeStructuredText(record.text)
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
  return joinReasoningText(normalizeTextParts(value, 'summary_text'))
}

function extractDetailedReasoningText(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeReasoningText(String(value))
  }

  const typedParts = normalizeTextParts(value, 'reasoning_text')
  if (typedParts.length > 0) {
    return joinReasoningText(typedParts)
  }

  if (Array.isArray(value)) {
    return joinReasoningText(value.map((item) => normalizeStructuredText(item)))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.content != null) {
      const contentText = Array.isArray(record.content)
        ? joinReasoningText(record.content.map((item) => normalizeStructuredText(item)))
        : normalizeReasoningText(normalizeStructuredText(record.content))
      if (contentText) return contentText
    }
    if (record.text != null) {
      const text = normalizeReasoningText(normalizeStructuredText(record.text))
      if (text) return text
    }
  }

  return ''
}

function mergeReasoningText(summary: string, details: string) {
  const normalizedDetails = normalizeReasoningText(details)
  if (normalizedDetails) return normalizedDetails

  const normalizedSummary = normalizeReasoningText(summary)
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

function isAnthropicModel(model: string) {
  return String(model || '')
    .trim()
    .toLowerCase()
    .startsWith('anthropic/')
}

function supportsAdaptiveThinking(model: string) {
  const normalized = String(model || '')
    .trim()
    .toLowerCase()

  return (
    /(?:^|\/)claude-4(?:[.-]6)-(?:opus|sonnet)(?:$|[-/])/.test(normalized) ||
    /(?:^|\/)claude-(?:opus|sonnet)-4(?:[.-]6)(?:$|[-/])/.test(normalized)
  )
}

function isZenmuxHost(hostname: string) {
  return hostname === 'zenmux.ai' || hostname.endsWith('.zenmux.ai')
}

function normalizeAnthropicBasePath(pathname: string) {
  const normalized = trimTrailingSlash(pathname || '')
  if (normalized.endsWith('/v1/messages')) {
    return normalized.slice(0, -'/v1/messages'.length)
  }
  if (normalized.endsWith('/messages')) {
    return normalized.slice(0, -'/messages'.length)
  }
  return normalized
}

function resolveAnthropicBaseUrl(baseUrl: string) {
  const trimmed = trimTrailingSlash(String(baseUrl || '').trim())
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const normalizedPath = normalizeAnthropicBasePath(url.pathname)

    if (normalizedPath === ZENMUX_ANTHROPIC_PATH) {
      return `${url.origin}${ZENMUX_ANTHROPIC_PATH}`
    }

    if (isZenmuxHost(url.hostname) && /^\/api\/v1(?:\/chat\/completions|\/responses)?$/.test(url.pathname)) {
      return `${url.origin}${ZENMUX_ANTHROPIC_PATH}`
    }
  } catch {
    return ''
  }

  return ''
}

function isAnthropicBaseUrl(baseUrl: string) {
  const trimmed = trimTrailingSlash(String(baseUrl || '').trim())
  const resolved = resolveAnthropicBaseUrl(baseUrl)
  if (!trimmed || !resolved) return false
  return trimmed === resolved || trimmed === `${resolved}/v1/messages` || trimmed === `${resolved}/messages`
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
  if (isAnthropicBaseUrl(baseUrl)) {
    return []
  }

  const orderedModes: RequestMode[] = preferredMode === 'auto' ? ['responses', 'chat-completions'] : [preferredMode]
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

function createAnthropicRequestConfig(settings: ProviderSettings, model: string): AnthropicRequestConfig | null {
  if (!isAnthropicModel(model)) return null

  const endpoint = resolveAnthropicBaseUrl(settings.baseUrl)
  if (!endpoint) return null

  return {
    endpoint,
    mode: ANTHROPIC_REQUEST_MODE,
  }
}

function buildAnthropicThinkingConfig(model: string): Anthropic.ThinkingConfigParam {
  if (supportsAdaptiveThinking(model)) {
    return { type: 'adaptive' }
  }

  return {
    type: 'enabled',
    budget_tokens: Math.min(DEFAULT_ANTHROPIC_THINKING_BUDGET, DEFAULT_ANTHROPIC_MAX_TOKENS - 1),
  }
}

function buildAnthropicMessages(messages: ChatCompletionOptions['messages']) {
  const systemParts: string[] = []
  const conversationalMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) {
        systemParts.push(message.content.trim())
      }
      continue
    }

    conversationalMessages.push({
      role: message.role,
      content: message.content,
    })
  }

  return {
    system: joinText(systemParts),
    messages: conversationalMessages,
  }
}

function buildAnthropicMessageParams(
  { model, messages }: ChatCompletionOptions,
  stream: false,
): Anthropic.MessageCreateParamsNonStreaming
function buildAnthropicMessageParams(
  { model, messages }: ChatCompletionOptions,
  stream: true,
): Anthropic.MessageCreateParamsStreaming
function buildAnthropicMessageParams({ model, messages }: ChatCompletionOptions, stream: boolean) {
  const prepared = buildAnthropicMessages(messages)
  const payload: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    messages: prepared.messages,
    max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
    thinking: buildAnthropicThinkingConfig(model),
  }

  if (prepared.system) {
    payload.system = prepared.system
  }

  if (stream) {
    return {
      ...payload,
      stream: true,
    }
  }

  return payload
}

function getAnthropicClient(settings: ProviderSettings, requestConfig: AnthropicRequestConfig) {
  const cacheKey = `${requestConfig.endpoint}::${settings.apiKey}`
  const cached = anthropicClientCache.get(cacheKey)
  if (cached) return cached

  const client = new Anthropic({
    apiKey: settings.apiKey,
    baseURL: requestConfig.endpoint,
    dangerouslyAllowBrowser: true,
  })
  anthropicClientCache.set(cacheKey, client)
  return client
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

  const summary = pickBestReasoningText(
    extractSummaryText(source.reasoning_summary),
    extractSummaryText(source.reasoning_summary_text),
    extractSummaryText(source.reasoningSummary),
    extractSummaryText(source.summary),
    extractSummaryText(reasoningObject?.summary),
    extractSummaryText(reasoningObject?.summary_text),
    extractSummaryText(reasoningObject?.summaryText),
  )
  const details = pickBestReasoningText(
    extractDetailedReasoningText(source.reasoning_details),
    extractDetailedReasoningText(source.reasoningDetails),
    extractDetailedReasoningText(source.thinking),
    extractDetailedReasoningText(source.reasoning_content),
    extractDetailedReasoningText(source.reasoningContent),
    extractDetailedReasoningText(source.reasoning_text),
    extractDetailedReasoningText(source.reasoningText),
    extractDetailedReasoningText(source.reasoning_message),
    extractDetailedReasoningText(typeof source.reasoning === 'string' ? source.reasoning : ''),
    extractDetailedReasoningText(reasoningObject?.content),
    extractDetailedReasoningText(reasoningObject?.details),
    extractDetailedReasoningText(reasoningObject?.text),
    extractDetailedReasoningText(reasoningObject?.reasoning_text),
  )

  return mergeReasoningText(summary, details)
}

function normalizeReasoningFragmentValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeReasoningFragment(String(value))
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeReasoningFragment(normalizeStructuredText(item))).filter(Boolean).join('')
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.content != null) {
      if (Array.isArray(record.content)) {
        return record.content.map((item) => normalizeReasoningFragment(normalizeStructuredText(item))).filter(Boolean).join('')
      }
      const contentText = normalizeReasoningFragment(normalizeStructuredText(record.content))
      if (contentText) return contentText
    }
    if (record.text != null) {
      const text = normalizeReasoningFragment(normalizeStructuredText(record.text))
      if (text) return text
    }
  }

  return ''
}

function extractReasoningDelta(delta: Record<string, unknown>) {
  const reasoningObject =
    delta.reasoning && typeof delta.reasoning === 'object' ? (delta.reasoning as Record<string, unknown>) : null

  for (const value of [
    normalizeReasoningFragmentValue(delta.reasoning_details),
    normalizeReasoningFragmentValue(delta.reasoningDetails),
    normalizeReasoningFragmentValue(delta.thinking),
    normalizeReasoningFragmentValue(delta.reasoning_content),
    normalizeReasoningFragmentValue(delta.reasoningContent),
    normalizeReasoningFragmentValue(delta.reasoning_text),
    normalizeReasoningFragmentValue(delta.reasoningText),
    normalizeReasoningFragmentValue(delta.reasoning_message),
    normalizeReasoningFragmentValue(typeof delta.reasoning === 'string' ? delta.reasoning : ''),
    normalizeReasoningFragmentValue(reasoningObject?.content),
    normalizeReasoningFragmentValue(reasoningObject?.details),
    normalizeReasoningFragmentValue(reasoningObject?.text),
    normalizeReasoningFragmentValue(reasoningObject?.reasoning_text),
  ]) {
    const normalized = normalizeReasoningFragment(value)
    if (normalized) return normalized
  }

  return ''
}

function extractChoiceMessage(choice: Record<string, unknown>) {
  return (choice.message as Record<string, unknown> | undefined) ?? {}
}

function buildChatResponseObject(message: Record<string, unknown>, fallbackReasoning = ''): ChatCompletionResult {
  return {
    content: normalizeStructuredText(message.content),
    reasoning_details: pickBestReasoningText(extractUnifiedReasoningText(message), fallbackReasoning) || null,
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
  const summary = joinReasoningText(reasoningItems.map((item) => extractSummaryText(item.summary)))
  const details = joinReasoningText(reasoningItems.map((item) => extractDetailedReasoningText(item.content)))
  const itemReasoning = mergeReasoningText(summary, details)

  return {
    content,
    reasoning_details: pickBestReasoningText(itemReasoning, extractUnifiedReasoningText(data)) || null,
  }
}

function parseAnthropicMessageResult(message: { content?: AnthropicContentBlockLike[] }): ChatCompletionResult {
  const contentBlocks = Array.isArray(message.content) ? message.content : []

  return {
    content: contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => normalizeStructuredText(block.text))
      .join(''),
    reasoning_details:
      joinReasoningText(
        contentBlocks
          .filter((block) => block.type === 'thinking')
          .map((block) => normalizeReasoningFragment(normalizeStructuredText(block.thinking)))
          .filter(Boolean),
      ) || null,
  }
}

function describeAnthropicStreamEventType(event: AnthropicStreamEventLike) {
  const eventType = normalizeStructuredText(event.type)
  if (eventType === 'content_block_start' && event.content_block) {
    return `${eventType}:${normalizeStructuredText(event.content_block.type)}`
  }
  if (eventType === 'content_block_delta' && event.delta) {
    return `${eventType}:${normalizeStructuredText(event.delta.type)}`
  }
  return eventType
}

function extractAnthropicStreamDelta(
  event: AnthropicStreamEventLike,
  activeBlockTypes: Map<number, string>,
): { delta_type: 'content' | 'reasoning'; text: string } | null {
  const eventType = normalizeStructuredText(event.type)
  const index = typeof event.index === 'number' ? event.index : null

  if (eventType === 'content_block_start' && index != null && event.content_block) {
    const block = event.content_block
    const blockType = normalizeStructuredText(block.type)
    activeBlockTypes.set(index, blockType)

    if (blockType === 'text') {
      const text = normalizeStructuredText(block.text)
      return text ? { delta_type: 'content', text } : null
    }

    if (blockType === 'thinking') {
      const text = normalizeReasoningFragment(normalizeStructuredText(block.thinking))
      return text ? { delta_type: 'reasoning', text } : null
    }

    return null
  }

  if (eventType === 'content_block_stop' && index != null) {
    activeBlockTypes.delete(index)
    return null
  }

  if (eventType !== 'content_block_delta' || index == null || !event.delta) {
    return null
  }

  const blockType = activeBlockTypes.get(index)
  const delta = event.delta
  const deltaType = normalizeStructuredText(delta.type)

  if (blockType === 'text' && deltaType === 'text_delta') {
    const text = normalizeStructuredText(delta.text)
    return text ? { delta_type: 'content', text } : null
  }

  if (blockType === 'thinking' && deltaType === 'thinking_delta') {
    const text = normalizeReasoningFragment(normalizeStructuredText(delta.thinking))
    return text ? { delta_type: 'reasoning', text } : null
  }

  return null
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

function buildCompletionDiagnostics(
  configuredMode: ProviderRequestMode,
  selectedMode: ResolvedRequestMode,
  endpoint: string,
  attempts: RequestAttemptDiagnostic[],
  parsed: Pick<ChatCompletionResult, 'content' | 'reasoning_details'>,
): ChatCompletionDiagnostics {
  return {
    configured_mode: configuredMode,
    selected_mode: selectedMode,
    endpoint,
    fallback_used: attempts.length > 1,
    attempts,
    stream_event_types: [],
    reasoning_event_count: parsed.reasoning_details ? 1 : 0,
    content_event_count: parsed.content ? 1 : 0,
    reasoning_text_chars: parsed.reasoning_details?.length || 0,
    content_text_chars: parsed.content.length,
    saw_reasoning: Boolean(parsed.reasoning_details),
    reasoning_details_present: Boolean(parsed.reasoning_details),
  }
}

function buildFailureDiagnostics(
  configuredMode: ProviderRequestMode,
  selectedMode: ResolvedRequestMode | null,
  endpoint: string,
  attempts: RequestAttemptDiagnostic[],
): ChatCompletionDiagnostics {
  return {
    configured_mode: configuredMode,
    selected_mode: selectedMode,
    endpoint,
    fallback_used: attempts.length > 1,
    attempts,
    stream_event_types: [],
    reasoning_event_count: 0,
    content_event_count: 0,
    reasoning_text_chars: 0,
    content_text_chars: 0,
    saw_reasoning: false,
    reasoning_details_present: false,
  }
}

function buildDiagnostics(
  requestConfig: RuntimeRequestConfig,
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

  for (const value of [
    normalizeStructuredText(payload.delta),
    normalizeStructuredText(payload.text),
    normalizeStructuredText(part?.delta),
    normalizeStructuredText(part?.text),
    normalizeStructuredText(part?.summary_text),
    normalizeStructuredText(payload.summary_text),
    normalizeStructuredText(payload.reasoning_text),
    normalizeStructuredText(payload.reasoning),
    normalizeStructuredText(payload.reasoning_summary),
    normalizeStructuredText(part?.summary),
    normalizeStructuredText(part?.content),
  ]) {
    const normalized = normalizeReasoningFragment(value)
    if (normalized) return normalized
  }

  return ''
}

async function doFetch(
  url: string,
  settings: ProviderSettings,
  payload: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  let didTimeout = false
  const timeoutId = window.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)
  const handleAbort = () => controller.abort()

  signal?.addEventListener('abort', handleAbort)
  if (signal?.aborted) {
    handleAbort()
  }

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
  } catch (error) {
    if (didTimeout && isAbortError(error)) {
      throw createRequestError('Request timed out')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', handleAbort)
  }
}

async function runAnthropicChatCompletion(
  settings: ProviderSettings,
  requestConfig: AnthropicRequestConfig,
  options: ChatCompletionOptions,
) {
  const client = getAnthropicClient(settings, requestConfig)
  const message = await client.messages.create(buildAnthropicMessageParams(options, false), {
    timeout: options.timeoutMs,
    signal: options.signal,
  })
  return parseAnthropicMessageResult(message)
}

async function* runAnthropicChatCompletionStream(
  settings: ProviderSettings,
  requestConfig: AnthropicRequestConfig,
  options: ChatCompletionOptions,
  context: StreamDiagnosticsContext,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const client = getAnthropicClient(settings, requestConfig)
  const stream = await client.messages.create(buildAnthropicMessageParams(options, true), {
    timeout: options.timeoutMs,
    signal: options.signal,
  })

  let contentAcc = ''
  let reasoningAcc = ''
  const activeBlockTypes = new Map<number, string>()
  const diagnostics = createStreamDiagnosticsAccumulator()

  for await (const rawEvent of stream) {
    const event = rawEvent as unknown as AnthropicStreamEventLike
    const eventType = describeAnthropicStreamEventType(event)
    if (eventType) {
      diagnostics.eventTypes.add(eventType)
    }

    const delta = extractAnthropicStreamDelta(event, activeBlockTypes)
    if (!delta?.text) continue

    if (delta.delta_type === 'content') {
      contentAcc += delta.text
      diagnostics.contentEventCount += 1
      diagnostics.contentTextChars += delta.text.length
      yield delta
      continue
    }

    reasoningAcc += delta.text
    diagnostics.reasoningEventCount += 1
    diagnostics.reasoningTextChars += delta.text.length
    yield delta
  }

  yield {
    delta_type: 'final',
    content: contentAcc,
    reasoning_details: reasoningAcc || null,
    diagnostics: buildDiagnostics(requestConfig, context, diagnostics, reasoningAcc || null, 'succeeded'),
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
  { model, messages, timeoutMs = 120000, signal }: ChatCompletionOptions,
) {
  const anthropicRequestConfig = createAnthropicRequestConfig(settings, model)
  const requestConfigs = createRequestConfigs(settings.baseUrl, settings.requestMode)
  let lastError: unknown = null
  const attempts: RequestAttemptDiagnostic[] = []

  if (anthropicRequestConfig) {
    try {
      const parsed = await runAnthropicChatCompletion(settings, anthropicRequestConfig, {
        model,
        messages,
        timeoutMs,
        signal,
      })
      const successAttempt: RequestAttemptDiagnostic = {
        mode: anthropicRequestConfig.mode,
        endpoint: anthropicRequestConfig.endpoint,
        status: 'succeeded',
      }
      const diagnosticAttempts = [...attempts, successAttempt]
      return {
        ...parsed,
        diagnostics: buildCompletionDiagnostics(
          settings.requestMode || 'auto',
          anthropicRequestConfig.mode,
          anthropicRequestConfig.endpoint,
          diagnosticAttempts,
          parsed,
        ),
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      lastError = error
      attempts.push({
        mode: anthropicRequestConfig.mode,
        endpoint: anthropicRequestConfig.endpoint,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: false }),
        timeoutMs,
        signal,
      )
      const data = (await response.json()) as Record<string, unknown>
      const parsed = parseJsonResult(requestConfig, data)
      const successAttempt: RequestAttemptDiagnostic = {
        mode: requestConfig.mode,
        endpoint: requestConfig.endpoint,
        status: 'succeeded',
      }
      const diagnosticAttempts = [...attempts, successAttempt]
      return {
        ...parsed,
        diagnostics: buildCompletionDiagnostics(
          settings.requestMode || 'auto',
          requestConfig.mode,
          requestConfig.endpoint,
          diagnosticAttempts,
          parsed,
        ),
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
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
    reasoning_details: pickBestReasoningText(reasoningDetails, reasoningAcc) || null,
    diagnostics: buildDiagnostics(
      requestConfig,
      context,
      diagnostics,
      pickBestReasoningText(reasoningDetails, reasoningAcc) || null,
      'succeeded',
    ),
  }
}

export async function* chatCompletionStream(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000, signal }: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  const anthropicRequestConfig = createAnthropicRequestConfig(settings, model)
  const requestConfigs = createRequestConfigs(settings.baseUrl, settings.requestMode)
  let lastError: unknown = null
  const attempts: RequestAttemptDiagnostic[] = []

  if (anthropicRequestConfig) {
    try {
      for await (const event of runAnthropicChatCompletionStream(
        settings,
        anthropicRequestConfig,
        { model, messages, timeoutMs, signal },
        {
          configuredMode: settings.requestMode || 'auto',
          previousAttempts: attempts,
          fallbackUsed: attempts.length > 0,
        },
      )) {
        yield event
      }
      return
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      lastError = error
      attempts.push({
        mode: anthropicRequestConfig.mode,
        endpoint: anthropicRequestConfig.endpoint,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const [index, requestConfig] of requestConfigs.entries()) {
    try {
      const response = await doFetch(
        requestConfig.endpoint,
        settings,
        buildPayload(requestConfig, { model, messages, stream: true }),
        timeoutMs,
        signal,
      )

      for await (const event of streamFromResponse(requestConfig, response, {
        configuredMode: settings.requestMode || 'auto',
        previousAttempts: attempts,
        fallbackUsed: attempts.length > 0 || index > 0,
      })) {
        yield event
      }
      return
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
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
        diagnostics: buildFailureDiagnostics(
          settings.requestMode || 'auto',
          requestConfig.mode,
          requestConfig.endpoint,
          attempts,
        ),
      }
      return
    }
  }

  yield {
    delta_type: 'error',
    message: lastError instanceof Error ? lastError.message : String(lastError || 'Request failed'),
    diagnostics: buildFailureDiagnostics(
      settings.requestMode || 'auto',
      requestConfigs[requestConfigs.length - 1]?.mode || anthropicRequestConfig?.mode || null,
      requestConfigs[requestConfigs.length - 1]?.endpoint || anthropicRequestConfig?.endpoint || '',
      attempts,
    ),
  }
}

export const __private__ = {
  buildAnthropicMessageParams,
  buildAnthropicThinkingConfig,
  buildHeaders,
  buildPayload,
  buildChatResponseObject,
  createAnthropicRequestConfig,
  createRequestConfigs,
  describeAnthropicStreamEventType,
  extractAnthropicStreamDelta,
  extractPayloadsFromBlock,
  extractReasoningDelta,
  extractResponsesEventDelta,
  isAnthropicBaseUrl,
  isAnthropicModel,
  supportsAdaptiveThinking,
  mergeReasoningText,
  normalizeStructuredText,
  normalizeReasoningValue,
  parseAnthropicMessageResult,
  parseResponsesResult,
  resolveAnthropicBaseUrl,
  resolveEndpoint,
  shouldFallbackToNextAttempt,
}

export const llmClient: ChatCompletionClient = {
  chatCompletion,
  chatCompletionStream,
}
