import { conversationStore } from './services/conversationStore'
import { runMdtConversationStream } from './services/mdtOrchestrator'
import { isProviderConfigured, settingsStore } from './services/providerSettings'
import type {
  HealthStatus,
  MdtEventHandler,
  ProviderSettingsInput,
  RuntimeConfig,
  SendMessagePayload,
  SendMessageResult,
} from '@/types'

function toRuntimeConfig(settings: Awaited<ReturnType<typeof settingsStore.get>>): RuntimeConfig {
  return {
    configured: isProviderConfigured(settings),
    council_models: settings.councilModels || [],
    chairman_model: settings.chairmanModel || '',
    title_model: settings.titleModel || settings.chairmanModel || '',
    base_url: settings.baseUrl || '',
  }
}

export const api = {
  async listConversations() {
    return conversationStore.listConversations()
  },

  async health(): Promise<HealthStatus> {
    const settings = await settingsStore.get()
    return {
      status: isProviderConfigured(settings) ? 'ready' : 'unconfigured',
      mode: 'browser-only',
    }
  },

  async getConfig() {
    return toRuntimeConfig(await settingsStore.get())
  },

  async getProviderSettings() {
    return settingsStore.get()
  },

  async saveProviderSettings(settings: ProviderSettingsInput) {
    return settingsStore.save(settings)
  },

  async clearProviderSettings() {
    return settingsStore.clear()
  },

  async createConversation() {
    return conversationStore.createConversation()
  },

  async getConversation(conversationId: string) {
    const conversation = await conversationStore.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Failed to get conversation')
    }
    return conversation
  },

  async deleteConversation(conversationId: string) {
    const deleted = await conversationStore.deleteConversation(conversationId)
    if (!deleted) {
      throw new Error('Failed to delete conversation')
    }
    return { ok: true }
  },

  async renameConversation(conversationId: string, title: string) {
    return conversationStore.updateConversationTitle(conversationId, title)
  },

  async sendMessage(conversationId: string, payload: SendMessagePayload): Promise<SendMessageResult> {
    const result: SendMessageResult = {
      stage1: [],
      stage2: [],
      stage3: null,
      metadata: null,
    }

    await this.sendMessageStream(conversationId, payload, (_eventType, event) => {
      if (event.type === 'stage1_complete') {
        result.stage1 = event.data
      } else if (event.type === 'stage2_complete') {
        result.stage2 = event.data
        result.metadata = event.metadata
      } else if (event.type === 'stage3_complete') {
        result.stage3 = event.data
      }
    })

    return result
  },

  async sendMessageStream(conversationId: string, payload: SendMessagePayload, onEvent: MdtEventHandler) {
    const settings = await settingsStore.get()
    return runMdtConversationStream({
      conversationId,
      content: payload.content || '',
      settings,
      onEvent,
    })
  },
}
