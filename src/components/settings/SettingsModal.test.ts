import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import SettingsModal from './SettingsModal.vue'

describe('SettingsModal', () => {
  it('emits save with parsed settings values', async () => {
    const { emitted } = render(SettingsModal, {
      props: {
        isOpen: true,
        settings: {
          baseUrl: 'https://example.com/chat/completions',
          apiKey: '',
          councilModels: ['openai/a'],
          chairmanModel: 'openai/a',
          titleModel: 'openai/a',
          extraHeaders: {},
        },
        error: '',
      },
    })

    await fireEvent.update(screen.getByLabelText(/API Key/i), 'secret-key')
    await fireEvent.update(screen.getByLabelText(/额外请求头/i), 'X-Title: LLM MDT')
    await fireEvent.click(screen.getByRole('button', { name: /保存设置/i }))

    const emittedEvents = emitted() as Record<string, Array<[unknown]>>
    const saveEvents = emittedEvents.save

    expect(saveEvents?.[0]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'secret-key',
        extraHeaders: { 'X-Title': 'LLM MDT' },
      }),
    )
  })
})
