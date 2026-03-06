import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import Sidebar from './Sidebar.vue'

describe('Sidebar', () => {
  it('emits project and conversation actions', async () => {
    const { emitted } = render(Sidebar, {
      props: {
        projects: [
          {
            id: 'project-1',
            name: '默认项目',
            created_at: '2026-03-06T00:00:00.000Z',
            conversation_count: 1,
            is_default: true,
          },
        ],
        conversations: [
          {
            id: 'conv-1',
            project_id: 'project-1',
            title: '病例讨论',
            created_at: '2026-03-06T00:00:00.000Z',
            message_count: 2,
          },
        ],
        groupedConversations: {
          今天: [
            {
              id: 'conv-1',
              project_id: 'project-1',
              title: '病例讨论',
              created_at: '2026-03-06T00:00:00.000Z',
              message_count: 2,
            },
          ],
        },
        currentProjectId: 'project-1',
        currentConversationId: 'conv-1',
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /新建项目/i }))
    await fireEvent.click(screen.getByRole('button', { name: /默认项目/i }))
    await fireEvent.click(screen.getByRole('button', { name: /病例讨论/i }))

    const emittedEvents = emitted() as Record<string, Array<unknown[]>>
    expect(emittedEvents['create-project']).toHaveLength(1)
    expect(emittedEvents['select-project']?.[0]).toEqual(['project-1'])
    expect(emittedEvents['select-conversation']?.[0]).toEqual(['conv-1'])
  })
})
