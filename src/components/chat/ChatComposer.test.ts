import { fireEvent, render, screen } from '@testing-library/vue'
import { defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ChatComposer from './ChatComposer.vue'

describe('ChatComposer', () => {
  it('emits send when submitting a configured prompt', async () => {
    const onSend = vi.fn()
    const Wrapper = defineComponent({
      components: { ChatComposer },
      setup() {
        const draft = ref('')
        return { draft, onSend }
      },
      template: '<ChatComposer v-model="draft" :provider-configured="true" @send="onSend" />',
    })

    render(Wrapper)

    await fireEvent.update(
      screen.getByPlaceholderText(/Ask your question/i),
      'How should the MDT work?',
    )
    await fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    expect(onSend).toHaveBeenCalledWith('How should the MDT work?')
  })

  it('shows setup guidance when the provider is not configured', () => {
    render(ChatComposer, {
      props: {
        modelValue: '',
        providerConfigured: false,
      },
    })

    expect(screen.getByText(/Configure provider settings to start a browser-only MDT run/i)).toBeInTheDocument()
  })
})
