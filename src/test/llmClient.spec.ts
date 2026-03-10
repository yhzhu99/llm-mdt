import { describe, expect, it } from 'vitest'
import { __private__ } from '@/services/llmClient'
import type { ProviderSettings } from '@/types'

const baseSettings: ProviderSettings = {
  baseUrl: 'https://zenmux.ai/api/v1',
  apiKey: 'test-key',
  councilModels: ['anthropic/claude-sonnet-4.5'],
  chairmanModel: 'anthropic/claude-sonnet-4.5',
  titleModel: 'anthropic/claude-sonnet-4.5',
  requestMode: 'auto',
}

describe('llmClient Anthropic routing', () => {
  it('keeps auto mode fallback for OpenAI-compatible endpoints', () => {
    expect(__private__.createRequestConfigs('https://zenmux.ai/api/v1', 'auto')).toEqual([
      { mode: 'responses', endpoint: 'https://zenmux.ai/api/v1/responses' },
      { mode: 'chat-completions', endpoint: 'https://zenmux.ai/api/v1/chat/completions' },
    ])
  })

  it('routes ZenMux Claude models to Anthropic Messages', () => {
    expect(__private__.createAnthropicRequestConfig(baseSettings, 'anthropic/claude-sonnet-4.5')).toEqual({
      mode: 'anthropic-messages',
      endpoint: 'https://zenmux.ai/api/anthropic',
    })
  })

  it('does not switch non-ZenMux Anthropic models to the Anthropic SDK path', () => {
    expect(
      __private__.createAnthropicRequestConfig(
        {
          ...baseSettings,
          baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        },
        'anthropic/claude-sonnet-4.5',
      ),
    ).toBeNull()
  })
})

describe('llmClient Anthropic payloads', () => {
  it('uses adaptive thinking for Claude 4.6 models', () => {
    const payload = __private__.buildAnthropicMessageParams(
      {
        model: 'anthropic/claude-4.6-opus',
        messages: [{ role: 'user', content: 'Explain DFS.' }],
      },
      false,
    )

    expect(payload).toMatchObject({
      model: 'anthropic/claude-4.6-opus',
      max_tokens: 16000,
      thinking: {
        type: 'adaptive',
      },
    })
  })

  it('keeps budget-based thinking for pre-4.6 Claude models', () => {
    const payload = __private__.buildAnthropicMessageParams(
      {
        model: 'anthropic/claude-sonnet-4.5',
        messages: [
          { role: 'system', content: 'Use concise answers.' },
          { role: 'user', content: 'Explain DFS.' },
        ],
      },
      false,
    )

    expect(payload).toMatchObject({
      model: 'anthropic/claude-sonnet-4.5',
      system: 'Use concise answers.',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000,
      },
      messages: [{ role: 'user', content: 'Explain DFS.' }],
    })
    expect(payload).not.toHaveProperty('stream')
  })

  it('marks streaming requests explicitly', () => {
    const payload = __private__.buildAnthropicMessageParams(
      {
        model: 'anthropic/claude-sonnet-4.5',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      true,
    )

    expect(payload.stream).toBe(true)
  })
})

describe('llmClient Anthropic parsing', () => {
  it('extracts thinking and final text from Anthropic responses', () => {
    expect(
      __private__.parseAnthropicMessageResult({
        content: [
          { type: 'thinking', thinking: 'First pass' },
          { type: 'text', text: 'Final answer' },
        ],
      }),
    ).toEqual({
      content: 'Final answer',
      reasoning_details: 'First pass',
    })
  })

  it('parses streaming thinking and text deltas', () => {
    const activeBlockTypes = new Map<number, string>()

    expect(
      __private__.extractAnthropicStreamDelta(
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: 'Let me think.' },
        },
        activeBlockTypes,
      ),
    ).toEqual({
      delta_type: 'reasoning',
      text: 'Let me think.',
    })

    expect(
      __private__.describeAnthropicStreamEventType({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: ' More detail.' },
      }),
    ).toBe('content_block_delta:thinking_delta')

    expect(
      __private__.extractAnthropicStreamDelta(
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' More detail.' },
        },
        activeBlockTypes,
      ),
    ).toEqual({
      delta_type: 'reasoning',
      text: 'More detail.',
    })

    expect(
      __private__.extractAnthropicStreamDelta(
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: 'Final' },
        },
        activeBlockTypes,
      ),
    ).toEqual({
      delta_type: 'content',
      text: 'Final',
    })

    expect(
      __private__.extractAnthropicStreamDelta(
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: ' answer' },
        },
        activeBlockTypes,
      ),
    ).toEqual({
      delta_type: 'content',
      text: ' answer',
    })

    expect(
      __private__.extractAnthropicStreamDelta(
        {
          type: 'content_block_stop',
          index: 0,
        },
        activeBlockTypes,
      ),
    ).toBeNull()
    expect(activeBlockTypes.has(0)).toBe(false)
  })
})
