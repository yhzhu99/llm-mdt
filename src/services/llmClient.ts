import type {
  ChatCompletionClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatCompletionStreamEvent,
  ProviderSettings,
} from '@/types'

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

function normalizeReasoningValue(value: unknown) {
  return normalizeStructuredText(value)
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
  const extraHeaders = Object.fromEntries(
    Object.entries(settings.extraHeaders ?? {}).filter(
      ([name, value]) => String(name ?? '').trim() && String(value ?? '').trim(),
    ),
  )

  return {
    ...extraHeaders,
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function buildPayload({ model, messages, stream }: ChatCompletionOptions & { stream: boolean }) {
  const payload: Record<string, unknown> = {
    model,
    messages,
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

function extractReasoningDelta(delta: Record<string, unknown>) {
  return normalizeReasoningValue(
    delta.reasoning ?? delta.thinking ?? delta.reasoning_content ?? delta.reasoning_details,
  )
}

function extractChoiceMessage(choice: Record<string, unknown>) {
  return (choice.message as Record<string, unknown> | undefined) ?? {}
}

function buildResponseObject(message: Record<string, unknown>, fallbackReasoning = ''): ChatCompletionResult {
  return {
    content: normalizeStructuredText(message.content),
    reasoning_details:
      normalizeReasoningValue(
        message.reasoning_details ?? message.reasoning ?? message.thinking ?? message.reasoning_content,
      ) || fallbackReasoning || null,
  }
}

async function doFetch(settings: ProviderSettings, payload: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(settings.baseUrl, {
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
  const response = await doFetch(settings, buildPayload({ model, messages, stream: false }), timeoutMs)
  const data = (await response.json()) as {
    choices?: Array<{ message?: Record<string, unknown> }>
  }
  const message = data.choices?.[0]?.message ?? {}
  return buildResponseObject(message)
}

export async function* chatCompletionStream(
  settings: ProviderSettings,
  { model, messages, timeoutMs = 120000 }: ChatCompletionOptions,
): AsyncGenerator<ChatCompletionStreamEvent> {
  let contentAcc = ''
  let reasoningAcc = ''
  let reasoningDetails: string | null = null

  try {
    const response = await doFetch(settings, buildPayload({ model, messages, stream: true }), timeoutMs)

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: Record<string, unknown> }>
      }
      const message = data.choices?.[0]?.message ?? {}
      const parsed = buildResponseObject(message)
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

          let payload: { choices?: Array<Record<string, unknown>> }
          try {
            payload = JSON.parse(payloadText) as { choices?: Array<Record<string, unknown>> }
          } catch {
            continue
          }

          const choice = payload.choices?.[0]
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

          const finalReasoning = normalizeReasoningValue(
            message.reasoning_details ?? message.reasoning ?? message.thinking ?? message.reasoning_content,
          )
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
    reasoning_details: reasoningDetails || reasoningAcc || null,
  }
}

export const __private__ = {
  buildHeaders,
  buildPayload,
  buildResponseObject,
  extractPayloadsFromBlock,
  normalizeStructuredText,
  normalizeReasoningValue,
}

export const llmClient: ChatCompletionClient = {
  chatCompletion,
  chatCompletionStream,
}
