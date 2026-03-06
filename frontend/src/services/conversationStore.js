import { requestToPromise, withStore } from './browserDb';

function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sortByCreatedAtDesc(items) {
  return [...items].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
}

function toMetadata(conversation) {
  return {
    id: conversation.id,
    created_at: conversation.created_at,
    title: conversation.title || 'New Conversation',
    message_count: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
  };
}

async function loadConversationOrThrow(conversationId) {
  const conversation = await conversationStore.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }
  return conversation;
}

export const conversationStore = {
  async listConversations() {
    const conversations = await withStore('conversations', 'readonly', (store) =>
      requestToPromise(store.getAll())
    );

    return sortByCreatedAtDesc(conversations.map(toMetadata));
  },

  async createConversation(conversationId = createId('conversation')) {
    const conversation = {
      id: conversationId,
      created_at: new Date().toISOString(),
      title: 'New Conversation',
      messages: [],
    };

    await this.saveConversation(conversation);
    return cloneValue(conversation);
  },

  async getConversation(conversationId) {
    const conversation = await withStore('conversations', 'readonly', (store) =>
      requestToPromise(store.get(conversationId))
    );

    return conversation ? cloneValue(conversation) : null;
  },

  async saveConversation(conversation) {
    const normalized = {
      ...cloneValue(conversation),
      title: conversation?.title || 'New Conversation',
      messages: Array.isArray(conversation?.messages) ? cloneValue(conversation.messages) : [],
    };

    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(store.put(normalized))
    );

    return cloneValue(normalized);
  },

  async addUserMessage(conversationId, content) {
    const conversation = await loadConversationOrThrow(conversationId);
    conversation.messages.push({
      id: createId('user'),
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    });
    await this.saveConversation(conversation);
    return cloneValue(conversation);
  },

  async addAssistantMessage(conversationId, message) {
    const conversation = await loadConversationOrThrow(conversationId);
    conversation.messages.push({
      id: message?.id || createId('assistant'),
      role: 'assistant',
      stage1: message?.stage1 || [],
      stage2: message?.stage2 || [],
      stage3: message?.stage3 || null,
      metadata: message?.metadata || null,
      created_at: message?.created_at || new Date().toISOString(),
    });
    await this.saveConversation(conversation);
    return cloneValue(conversation);
  },

  async updateConversationTitle(conversationId, title) {
    const conversation = await loadConversationOrThrow(conversationId);
    conversation.title = String(title || '').trim() || 'Conversation';
    await this.saveConversation(conversation);
    return cloneValue(conversation);
  },

  async deleteConversation(conversationId) {
    const existing = await this.getConversation(conversationId);
    if (!existing) {
      return false;
    }

    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(store.delete(conversationId))
    );

    return true;
  },

  async clearAll() {
    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(store.clear())
    );
  },
};
