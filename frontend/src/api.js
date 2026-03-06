import { conversationStore } from './services/conversationStore';
import { runMdtConversationStream } from './services/mdtOrchestrator';
import {
  isProviderConfigured,
  settingsStore,
} from './services/providerSettings';

function toRuntimeConfig(settings) {
  return {
    configured: isProviderConfigured(settings),
    council_models: settings?.councilModels || [],
    chairman_model: settings?.chairmanModel || '',
    title_model: settings?.titleModel || settings?.chairmanModel || '',
    base_url: settings?.baseUrl || '',
  };
}

export const api = {
  async listConversations() {
    return conversationStore.listConversations();
  },

  async health() {
    const settings = await settingsStore.get();
    return {
      status: isProviderConfigured(settings) ? 'ready' : 'unconfigured',
      mode: 'browser-only',
    };
  },

  async getConfig() {
    return toRuntimeConfig(await settingsStore.get());
  },

  async getProviderSettings() {
    return settingsStore.get();
  },

  async saveProviderSettings(settings) {
    return settingsStore.save(settings);
  },

  async clearProviderSettings() {
    return settingsStore.clear();
  },

  async createConversation() {
    return conversationStore.createConversation();
  },

  async getConversation(conversationId) {
    const conversation = await conversationStore.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Failed to get conversation');
    }
    return conversation;
  },

  async deleteConversation(conversationId) {
    const deleted = await conversationStore.deleteConversation(conversationId);
    if (!deleted) {
      throw new Error('Failed to delete conversation');
    }
    return { ok: true };
  },

  async renameConversation(conversationId, title) {
    return conversationStore.updateConversationTitle(conversationId, title);
  },

  async sendMessage(conversationId, payload) {
    const result = {
      stage1: [],
      stage2: [],
      stage3: null,
      metadata: null,
    };

    await this.sendMessageStream(conversationId, payload, (eventType, event) => {
      if (eventType === 'stage1_complete') {
        result.stage1 = event.data || [];
      } else if (eventType === 'stage2_complete') {
        result.stage2 = event.data || [];
        result.metadata = event.metadata || null;
      } else if (eventType === 'stage3_complete') {
        result.stage3 = event.data || null;
      }
    });

    return result;
  },

  async sendMessageStream(conversationId, payload, onEvent) {
    const settings = await settingsStore.get();
    return runMdtConversationStream({
      conversationId,
      content: payload?.content || '',
      settings,
      onEvent,
    });
  },
};
