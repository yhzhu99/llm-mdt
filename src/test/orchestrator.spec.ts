import { describe, expect, it, vi } from 'vitest'
import { runMdtConversationStream } from '@/services/mdtOrchestrator'
import type { Conversation, ConversationRepository, ProviderSettings, UserInputPayload } from '@/types'

const conversation: Conversation = {
  id: 'conversation-1',
  project_id: 'project-1',
  created_at: '2026-03-15T00:00:00.000Z',
  title: '',
  messages: [],
}

const baseSettings: ProviderSettings = {
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: 'test-key',
  councilModels: ['deepseek/deepseek-reasoner'],
  chairmanModel: 'openai/gpt-5.4',
  titleModel: 'openai/gpt-5.4',
  requestMode: 'auto',
}

const multimodalInput: UserInputPayload = {
  text: 'Inspect the attached report.',
  attachments: [
    {
      id: 'attachment-1',
      kind: 'file',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 256,
      dataUrl: 'data:application/pdf;base64,BBBB',
      textContent: null,
    },
  ],
}

describe('orchestrator attachment validation', () => {
  it('rejects DeepSeek runs with attachments before provider calls', async () => {
    const addUserMessage = vi.fn(async () => conversation)
    const repo: ConversationRepository = {
      createConversation: async () => conversation,
      getConversation: async () => conversation,
      saveConversation: async (value) => value,
      addUserMessage,
      addAssistantMessage: async () => conversation,
      updateConversationTitle: async () => conversation,
    }
    const client = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
    }

    await expect(
      runMdtConversationStream({
        conversationId: conversation.id,
        input: multimodalInput,
        locale: 'en',
        settings: baseSettings,
        conversationRepo: repo,
        client: client as never,
      }),
    ).rejects.toThrow(/DeepSeek/)

    expect(addUserMessage).not.toHaveBeenCalled()
    expect(client.chatCompletion).not.toHaveBeenCalled()
    expect(client.chatCompletionStream).not.toHaveBeenCalled()
  })
})
