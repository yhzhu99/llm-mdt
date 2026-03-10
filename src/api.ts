import { conversationStore } from './services/conversationStore'
import { conversationRunStore } from './services/conversationRunStore'
import { appPreferencesStore } from './services/appPreferences'
import { runMdtConversationStream } from './services/mdtOrchestrator'
import { projectStore } from './services/projectStore'
import { isProviderConfigured, settingsStore } from './services/providerSettings'
import type {
  AppPreferences,
  AppLocale,
  Conversation,
  HealthStatus,
  MdtEventHandler,
  MdtRunOptions,
  PersistedConversationRun,
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
    request_mode: settings.requestMode || 'auto',
  }
}

export const api = {
  async listConversations(projectId?: string | null) {
    return conversationStore.listConversations(projectId)
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

  async saveProviderSettings(settings: ProviderSettingsInput, locale?: AppLocale) {
    return settingsStore.save(settings, locale)
  },

  async clearProviderSettings() {
    return settingsStore.clear()
  },

  async createConversation() {
    return conversationStore.createConversation()
  },

  async createConversationForProject(projectId: string, title = '') {
    return conversationStore.createConversationForProject(projectId, { title })
  },

  async getConversation(conversationId: string) {
    const conversation = await conversationStore.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Failed to get conversation')
    }
    return conversation
  },

  async saveConversation(conversation: Conversation) {
    return conversationStore.saveConversation(conversation)
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

  async listConversationRuns() {
    return conversationRunStore.list()
  },

  async saveConversationRun(run: PersistedConversationRun) {
    return conversationRunStore.save(run)
  },

  async deleteConversationRun(conversationId: string) {
    return conversationRunStore.delete(conversationId)
  },

  async deleteConversationRunsByProject(projectId: string) {
    return conversationRunStore.deleteByProject(projectId)
  },

  async listProjects() {
    return projectStore.listProjects()
  },

  async createProject(name: string) {
    return projectStore.createProject(name)
  },

  async renameProject(projectId: string, name: string) {
    return projectStore.renameProject(projectId, name)
  },

  async deleteProject(projectId: string) {
    return projectStore.deleteProject(projectId)
  },

  async getAppPreferences() {
    return appPreferencesStore.get()
  },

  async saveAppPreferences(input: Partial<AppPreferences>) {
    return appPreferencesStore.save(input)
  },

  async sendMessage(
    conversationId: string,
    payload: SendMessagePayload,
    options?: MdtRunOptions,
  ): Promise<SendMessageResult> {
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
    }, options)

    return result
  },

  async sendMessageStream(
    conversationId: string,
    payload: SendMessagePayload,
    onEvent: MdtEventHandler,
    options?: MdtRunOptions,
  ) {
    const settings = await settingsStore.get()
    return runMdtConversationStream({
      conversationId,
      content: payload.content || '',
      locale: payload.locale,
      settings,
      onEvent,
      options,
    })
  },
}
