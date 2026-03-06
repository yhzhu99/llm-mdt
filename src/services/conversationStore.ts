import { requestToPromise, withStore } from './browserDb'
import { projectStore } from './projectStore'
import type {
  AssistantMessageRecord,
  Conversation,
  ConversationMessage,
  ConversationRepository,
  ConversationSummary,
} from '@/types'

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function sortByCreatedAtDesc(items: ConversationSummary[]) {
  return [...items].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )
}

function toMetadata(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    project_id: conversation.project_id,
    created_at: conversation.created_at,
    title: conversation.title || '',
    message_count: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
  }
}

async function loadConversationOrThrow(conversationId: string) {
  const conversation = await conversationStore.getConversation(conversationId)
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`)
  }
  return conversation
}

function normalizeMessages(messages: ConversationMessage[] | undefined) {
  return Array.isArray(messages) ? cloneValue(messages) : []
}

async function ensureProjectId(projectId?: string) {
  if (projectId) return projectId
  const project = await projectStore.ensureDefaultProject()
  return project.id
}

function asObjectStore(store: IDBObjectStore | Record<string, IDBObjectStore>) {
  return store as IDBObjectStore
}

export const conversationStore: ConversationRepository & {
  createConversationForProject: (
    projectId: string,
    options?: {
      conversationId?: string
      title?: string
    },
  ) => Promise<Conversation>
  deleteConversation: (conversationId: string) => Promise<boolean>
  listConversations: (projectId?: string | null) => Promise<ConversationSummary[]>
  clearAll: () => Promise<void>
} = {
  async listConversations(projectId) {
    await projectStore.ensureDefaultProject()
    const conversations = await withStore('conversations', 'readonly', (store) =>
      requestToPromise(asObjectStore(store).getAll() as IDBRequest<Conversation[]>),
    )

    const normalizedProjectId = projectId || null

    return sortByCreatedAtDesc(
      conversations
        .filter((conversation) => !normalizedProjectId || conversation.project_id === normalizedProjectId)
        .map(toMetadata),
    )
  },

  async createConversation(conversationId = createId('conversation')) {
    const projectId = await ensureProjectId()
    const conversation: Conversation = {
      id: conversationId,
      project_id: projectId,
      created_at: new Date().toISOString(),
      title: '',
      messages: [],
    }

    await this.saveConversation(conversation)
    return cloneValue(conversation)
  },

  async createConversationForProject(projectId, options) {
    const nextProjectId = await ensureProjectId(projectId)
    const conversation: Conversation = {
      id: options?.conversationId || createId('conversation'),
      project_id: nextProjectId,
      created_at: new Date().toISOString(),
      title: String(options?.title ?? '').trim(),
      messages: [],
    }

    await this.saveConversation(conversation)
    return cloneValue(conversation)
  },

  async getConversation(conversationId: string) {
    await projectStore.ensureDefaultProject()
    const conversation = await withStore('conversations', 'readonly', (store) =>
      requestToPromise(asObjectStore(store).get(conversationId) as IDBRequest<Conversation | undefined>),
    )

    return conversation ? cloneValue(conversation) : null
  },

  async saveConversation(conversation: Conversation) {
    const projectId = await ensureProjectId(conversation.project_id)
    const normalized: Conversation = {
      ...cloneValue(conversation),
      project_id: projectId,
      title: String(conversation.title ?? '').trim(),
      messages: normalizeMessages(conversation.messages),
    }

    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(asObjectStore(store).put(normalized) as IDBRequest<IDBValidKey>),
    )

    return cloneValue(normalized)
  },

  async addUserMessage(conversationId: string, content: string) {
    const conversation = await loadConversationOrThrow(conversationId)
    conversation.messages.push({
      id: createId('user'),
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    })
    await this.saveConversation(conversation)
    return cloneValue(conversation)
  },

  async addAssistantMessage(conversationId: string, message: AssistantMessageRecord) {
    const conversation = await loadConversationOrThrow(conversationId)
    conversation.messages.push({
      id: message.id || createId('assistant'),
      role: 'assistant',
      stage1: message.stage1 || [],
      stage2: message.stage2 || [],
      stage3: message.stage3 || null,
      metadata: message.metadata || null,
      created_at: message.created_at || new Date().toISOString(),
    })
    await this.saveConversation(conversation)
    return cloneValue(conversation)
  },

  async updateConversationTitle(conversationId: string, title: string) {
    const conversation = await loadConversationOrThrow(conversationId)
    conversation.title = String(title || '').trim()
    await this.saveConversation(conversation)
    return cloneValue(conversation)
  },

  async deleteConversation(conversationId: string) {
    const existing = await this.getConversation(conversationId)
    if (!existing) {
      return false
    }

    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(asObjectStore(store).delete(conversationId) as IDBRequest<undefined>),
    )

    return true
  },

  async clearAll() {
    await withStore('conversations', 'readwrite', (store) =>
      requestToPromise(asObjectStore(store).clear() as IDBRequest<undefined>),
    )
  },
}
