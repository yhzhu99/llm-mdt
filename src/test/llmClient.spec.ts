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

describe('llmClient multimodal payloads', () => {
  it('builds Responses payloads with text, image, and file parts', () => {
    const payload = __private__.buildPayload(
      {
        mode: 'responses',
        endpoint: 'https://api.openai.com/v1/responses',
      },
      {
        model: 'openai/gpt-5.4',
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect the attachments.' },
              { type: 'image', imageUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', name: 'scan.png' },
              {
                type: 'file',
                fileName: 'report.pdf',
                dataUrl: 'data:application/pdf;base64,BBBB',
                mimeType: 'application/pdf',
                textContent: null,
              },
              {
                type: 'file',
                fileName: 'notes.txt',
                dataUrl: 'data:text/plain;base64,Qm9keQ==',
                mimeType: 'text/plain',
                textContent: 'Body',
              },
            ],
          },
        ],
      },
    )

    expect(payload).toMatchObject({
      model: 'openai/gpt-5.4',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Inspect the attachments.' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
            { type: 'input_file', filename: 'report.pdf', file_data: 'data:application/pdf;base64,BBBB' },
            { type: 'input_file', filename: 'notes.txt', file_data: 'data:text/plain;base64,Qm9keQ==' },
          ],
        },
      ],
    })
  })

  it('builds Chat Completions payloads with multimodal user content', () => {
    const payload = __private__.buildPayload(
      {
        mode: 'chat-completions',
        endpoint: 'https://api.openai.com/v1/chat/completions',
      },
      {
        model: 'openai/gpt-5.4',
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect the attachments.' },
              { type: 'image', imageUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', name: 'scan.png' },
              {
                type: 'file',
                fileName: 'report.pdf',
                dataUrl: 'data:application/pdf;base64,BBBB',
                mimeType: 'application/pdf',
                textContent: null,
              },
            ],
          },
        ],
      },
    )

    expect(payload).toMatchObject({
      model: 'openai/gpt-5.4',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect the attachments.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            {
              type: 'file',
              file: {
                filename: 'report.pdf',
                file_data: 'data:application/pdf;base64,BBBB',
              },
            },
          ],
        },
      ],
    })
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

  it('maps multimodal user content to Anthropic image and document blocks', () => {
    const payload = __private__.buildAnthropicMessageParams(
      {
        model: 'anthropic/claude-sonnet-4.5',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect the attachments.' },
              { type: 'image', imageUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', name: 'scan.png' },
              {
                type: 'file',
                fileName: 'report.pdf',
                dataUrl: 'data:application/pdf;base64,BBBB',
                mimeType: 'application/pdf',
                textContent: null,
              },
              {
                type: 'file',
                fileName: 'notes.txt',
                dataUrl: 'data:text/plain;base64,Qm9keQ==',
                mimeType: 'text/plain',
                textContent: 'Plain text body',
              },
            ],
          },
        ],
      },
      false,
    )

    expect(payload.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect the attachments.' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'AAAA',
            },
          },
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: 'BBBB',
            },
            title: 'report.pdf',
          },
          {
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: 'Plain text body',
            },
            title: 'notes.txt',
          },
        ],
      },
    ])
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
      text: ' More detail.',
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

describe('llmClient reasoning whitespace preservation', () => {
  it('keeps whitespace-only reasoning deltas', () => {
    expect(
      __private__.extractReasoningDelta({
        reasoning_text: ' ',
      }),
    ).toBe(' ')
  })

  it('keeps leading spaces in chat-completions reasoning deltas', () => {
    expect(
      __private__.extractReasoningDelta({
        reasoning_text: ' about the "50米洗车问题"',
      }),
    ).toBe(' about the "50米洗车问题"')
  })

  it('keeps structured reasoning summary spacing from responses items', () => {
    expect(
      __private__.parseResponsesResult({
        output: [
          {
            type: 'reasoning',
            summary: [
              { type: 'summary_text', text: 'The user is asking' },
              { type: 'summary_text', text: ' about the "50米洗车问题".' },
            ],
          },
        ],
      }),
    ).toEqual({
      content: '',
      reasoning_details: 'The user is asking about the "50米洗车问题".',
    })
  })

  it('keeps explicit newlines between Anthropic thinking blocks', () => {
    expect(
      __private__.parseAnthropicMessageResult({
        content: [
          { type: 'thinking', thinking: 'First line.\n' },
          { type: 'thinking', thinking: '\nSecond line.' },
          { type: 'text', text: 'Final answer' },
        ],
      }),
    ).toEqual({
      content: 'Final answer',
      reasoning_details: 'First line.\n\nSecond line.',
    })
  })
})
