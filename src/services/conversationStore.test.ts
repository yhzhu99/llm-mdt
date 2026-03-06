import { beforeEach, describe, expect, it } from 'vitest'
import { resetBrowserDb } from './browserDb'
import { conversationStore } from './conversationStore'
import { DEFAULT_PROJECT_ID, projectStore } from './projectStore'

describe('conversationStore', () => {
  beforeEach(async () => {
    await resetBrowserDb().catch(() => {})
  })

  it('creates, updates, lists, and deletes conversations', async () => {
    await conversationStore.createConversation('conv-1')
    await conversationStore.addUserMessage('conv-1', 'How should the MDT work?')
    await conversationStore.updateConversationTitle('conv-1', 'Browser MDT')

    const conversation = await conversationStore.getConversation('conv-1')
    expect(conversation?.title).toBe('Browser MDT')
    expect(conversation?.project_id).toBe(DEFAULT_PROJECT_ID)
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]).toMatchObject({
      content: 'How should the MDT work?',
    })

    const listed = await conversationStore.listConversations()
    expect(listed).toEqual([
      expect.objectContaining({
        id: 'conv-1',
        project_id: DEFAULT_PROJECT_ID,
        title: 'Browser MDT',
        message_count: 1,
      }),
    ])

    await conversationStore.addAssistantMessage('conv-1', {
      stage1: [{ model: 'openai/test', response: 'Answer', reasoning_details: null }],
      stage2: [],
      stage3: { model: 'openai/test', response: 'Final', reasoning_details: null },
      metadata: { label_to_model: {}, aggregate_rankings: [], positions_by_model: {}, stage2_parsed_rankings: [] },
    })

    const updated = await conversationStore.getConversation('conv-1')
    expect(updated?.messages).toHaveLength(2)
    expect(updated?.messages[1]).toMatchObject({ role: 'assistant' })

    expect(await conversationStore.deleteConversation('conv-1')).toBe(true)
    expect(await conversationStore.deleteConversation('conv-1')).toBe(false)
    expect(await conversationStore.listConversations()).toEqual([])
  })

  it('lists conversations by project', async () => {
    const project = await projectStore.createProject('Project A')
    await conversationStore.createConversationForProject(project.id, {
      conversationId: 'conv-a',
      title: 'Project Conversation',
    })
    await conversationStore.createConversation('conv-default')

    expect(await conversationStore.listConversations(project.id)).toEqual([
      expect.objectContaining({
        id: 'conv-a',
        project_id: project.id,
      }),
    ])
    expect(await conversationStore.listConversations(DEFAULT_PROJECT_ID)).toEqual([
      expect.objectContaining({
        id: 'conv-default',
        project_id: DEFAULT_PROJECT_ID,
      }),
    ])
  })
})
