import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import TopBar from './TopBar.vue'

describe('TopBar', () => {
  it('emits locale changes from the language switcher', async () => {
    const { emitted } = render(TopBar, {
      props: {
        title: '大模型会诊讨论',
        status: 'ready',
        statusText: '已就绪',
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /English/i }))

    const emittedEvents = emitted() as Record<string, Array<unknown[]>>
    expect(emittedEvents['change-locale']?.[0]).toEqual(['en'])
  })
})
