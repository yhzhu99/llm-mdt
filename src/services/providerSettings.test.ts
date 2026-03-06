import { describe, expect, it } from 'vitest'
import {
  formatHeaderLines,
  formatModelList,
  parseHeaderLines,
  parseModelList,
  sanitizeProviderSettings,
  validateProviderSettings,
} from './providerSettings'

describe('providerSettings', () => {
  it('parses and formats model lists', () => {
    expect(parseModelList(' openai/a\nopenai/b, openai/a ')).toEqual(['openai/a', 'openai/b'])
    expect(formatModelList(['openai/a', 'openai/b'])).toBe('openai/a\nopenai/b')
  })

  it('parses and formats extra headers', () => {
    expect(parseHeaderLines('X-Title: LLM MDT\nInvalid\nAuthorization: Bearer demo')).toEqual({
      'X-Title': 'LLM MDT',
      Authorization: 'Bearer demo',
    })
    expect(formatHeaderLines({ 'X-Title': 'LLM MDT' })).toBe('X-Title: LLM MDT')
  })

  it('sanitizes and validates settings', () => {
    expect(
      sanitizeProviderSettings({
        baseUrl: ' https://example.com ',
        apiKey: ' secret ',
        councilModels: 'openai/a, openai/b',
        chairmanModel: '',
        titleModel: '',
        extraHeaders: { 'X-Test': ' 1 ' },
      }),
    ).toEqual({
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      councilModels: ['openai/a', 'openai/b'],
      chairmanModel: 'openai/a',
      titleModel: 'openai/a',
      extraHeaders: { 'X-Test': ' 1 ' },
    })

    expect(() => validateProviderSettings({ baseUrl: '', apiKey: '' })).toThrow(/base url/i)
  })
})
