import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/api'
import type {
  AssistantConversationMessage,
  AssistantLoadingState,
  AssistantStreamMeta,
  AssistantStreamState,
  Conversation,
  ConversationSummary,
  ProviderSettings,
  ProviderSettingsInput,
  RuntimeConfig,
  Stage1StreamState,
  Stage2StreamState,
  Stage3StreamState,
  StreamStatusMeta,
} from '@/types'
import { getProviderStatusText, groupConversationsByDate, toRuntimeConfig } from '@/utils/conversations'

const cloneValue = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

type LiveAssistantMessage = AssistantConversationMessage & {
  stream: AssistantStreamState
  streamMeta: AssistantStreamMeta
  loading: AssistantLoadingState
}

const createStreamStatusMeta = (models: string[]) =>
  Object.fromEntries(models.map((model) => [model, { status: 'idle' as const }]))

const createAssistantMessage = (councilOrder: string[]): LiveAssistantMessage => ({
  id:
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `assistant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  role: 'assistant',
  stage1: null,
  stage2: null,
  stage3: null,
  metadata: null,
  created_at: new Date().toISOString(),
  stream: {
    stage1: {},
    stage2: {},
    stage3: { response: '', thinking: '' },
  },
  streamMeta: {
    stage1: createStreamStatusMeta(councilOrder),
    stage2: createStreamStatusMeta(councilOrder),
    stage3: { status: 'idle' },
  },
  loading: {
    stage1: false,
    stage2: false,
    stage3: false,
  },
})

const ensureLiveAssistantMessage = (message: AssistantConversationMessage): LiveAssistantMessage => ({
  ...message,
  stream: {
    stage1: { ...(message.stream?.stage1 || {}) },
    stage2: { ...(message.stream?.stage2 || {}) },
    stage3: {
      response: message.stream?.stage3?.response || '',
      thinking: message.stream?.stage3?.thinking || '',
    },
  },
  streamMeta: {
    stage1: { ...(message.streamMeta?.stage1 || {}) },
    stage2: { ...(message.streamMeta?.stage2 || {}) },
    stage3: {
      status: message.streamMeta?.stage3?.status || 'idle',
      ...(message.streamMeta?.stage3?.message ? { message: message.streamMeta.stage3.message } : {}),
    },
  },
  loading: {
    stage1: message.loading?.stage1 || false,
    stage2: message.loading?.stage2 || false,
    stage3: message.loading?.stage3 || false,
  },
})

export function useMdtApp() {
  const conversations = ref<ConversationSummary[]>([])
  const currentConversationId = ref<string | null>(null)
  const currentConversation = ref<Conversation | null>(null)
  const isLoading = ref(false)
  const isRefreshingAfterStream = ref(false)
  const draftConversationId = ref<string | null>(null)
  const draftMessage = ref('')
  const providerSettings = ref<ProviderSettings | null>(null)
  const isSettingsOpen = ref(false)
  const settingsError = ref('')
  const lastProviderError = ref('')
  const isSidebarCollapsed = ref(false)

  const runtimeConfig = computed<RuntimeConfig>(() => toRuntimeConfig(providerSettings.value))
  const groupedConversations = computed(() => groupConversationsByDate(conversations.value))
  const providerConfigured = computed(() => runtimeConfig.value.configured)
  const providerStatus = computed<'ready' | 'running' | 'error' | 'unconfigured'>(() => {
    if (isLoading.value) return 'running'
    if (lastProviderError.value) return 'error'
    if (providerConfigured.value) return 'ready'
    return 'unconfigured'
  })
  const providerStatusText = computed(() =>
    getProviderStatusText(providerStatus.value, providerSettings.value, lastProviderError.value),
  )

  const loadConversations = async () => {
    try {
      conversations.value = await api.listConversations()
    } catch (error) {
      console.error('Failed to load conversations', error)
    }
  }

  const loadProviderSettings = async () => {
    try {
      providerSettings.value = await api.getProviderSettings()
    } catch (error) {
      console.error('Failed to load provider settings', error)
      lastProviderError.value = 'Failed to load local settings'
    }
  }

  const loadConversation = async (conversationId: string) => {
    try {
      currentConversation.value = await api.getConversation(conversationId)
    } catch (error) {
      console.error('Failed to load conversation', error)
      if (currentConversationId.value === conversationId) {
        currentConversation.value = null
      }
    }
  }

  const updateCurrentConversation = (updater: (conversation: Conversation | null) => Conversation | null) => {
    currentConversation.value = updater(currentConversation.value ? cloneValue(currentConversation.value) : null)
  }

  const upsertConversationInSidebar = (conversation: Partial<ConversationSummary> & Pick<ConversationSummary, 'id'>) => {
    conversations.value = (() => {
      const list = Array.isArray(conversations.value) ? [...conversations.value] : []
      const index = list.findIndex((entry) => entry.id === conversation.id)
      if (index === -1) {
        list.unshift({
          id: conversation.id,
          created_at: conversation.created_at || new Date().toISOString(),
          title: conversation.title || 'New Conversation',
          message_count: conversation.message_count ?? 0,
        })
      } else {
        const existing = list[index]!
        list[index] = {
          id: conversation.id,
          created_at: conversation.created_at || existing.created_at,
          title: conversation.title || existing.title,
          message_count: conversation.message_count ?? existing.message_count,
        }
      }

      return list.sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      )
    })()
  }

  const openSettings = () => {
    settingsError.value = ''
    isSettingsOpen.value = true
  }

  const closeSettings = () => {
    isSettingsOpen.value = false
  }

  const saveSettings = async (settings: ProviderSettingsInput) => {
    try {
      providerSettings.value = await api.saveProviderSettings(settings)
      settingsError.value = ''
      lastProviderError.value = ''
      isSettingsOpen.value = false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      settingsError.value = message
      throw error
    }
  }

  const clearSettings = async () => {
    try {
      providerSettings.value = await api.clearProviderSettings()
      settingsError.value = ''
      lastProviderError.value = ''
    } catch (error) {
      settingsError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const newConversation = () => {
    currentConversationId.value = null
    currentConversation.value = null
    draftConversationId.value = null
    draftMessage.value = ''
  }

  const deleteConversation = async (conversationId: string) => {
    try {
      await api.deleteConversation(conversationId)
      if (currentConversationId.value === conversationId) {
        newConversation()
      }
      await loadConversations()
    } catch (error) {
      console.error('Failed to delete conversation', error)
    }
  }

  const renameConversation = async (conversationId: string, title: string) => {
    try {
      await api.renameConversation(conversationId, title)
      await loadConversations()
      if (currentConversationId.value === conversationId) {
        await loadConversation(conversationId)
      }
    } catch (error) {
      console.error('Failed to rename conversation', error)
    }
  }

  const selectConversation = (conversationId: string) => {
    currentConversationId.value = conversationId
  }

  const ensureConversationForSend = async () => {
    if (currentConversationId.value) return currentConversationId.value
    if (draftConversationId.value) {
      currentConversationId.value = draftConversationId.value
      return draftConversationId.value
    }

    const conversation = await api.createConversation()
    draftConversationId.value = conversation.id
    currentConversationId.value = conversation.id
    return conversation.id
  }

  const sendMessage = async (content: string) => {
    if (!providerConfigured.value) {
      lastProviderError.value = 'Configure a browser-capable provider before sending a message.'
      openSettings()
      return
    }

    let conversationIdForRequest: string

    try {
      conversationIdForRequest = await ensureConversationForSend()
    } catch (error) {
      console.error('Failed to create conversation', error)
      return
    }

    lastProviderError.value = ''
    isLoading.value = true
    isRefreshingAfterStream.value = false

    try {
      const optimisticCreatedAt = currentConversation.value?.created_at || new Date().toISOString()

      updateCurrentConversation((conversation) =>
        conversation || {
          id: conversationIdForRequest,
          created_at: optimisticCreatedAt,
          title: 'New Conversation',
          messages: [],
        },
      )

      upsertConversationInSidebar({
        id: conversationIdForRequest,
        created_at: optimisticCreatedAt,
        title: currentConversation.value?.title || 'New Conversation',
        message_count: 1,
      })

      updateCurrentConversation((conversation) => {
        if (!conversation) return conversation
        conversation.messages.push({
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        })
        return conversation
      })

      const assistantMessage = createAssistantMessage(runtimeConfig.value.council_models)

      updateCurrentConversation((conversation) => {
        if (!conversation) return conversation
        conversation.messages.push(assistantMessage)
        return conversation
      })

      const updateAssistantMessage = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
        updateCurrentConversation((conversation) => {
          if (!conversation) return conversation
          const index = conversation.messages.findIndex(
            (message) => message.role === 'assistant' && message.id === assistantMessage.id,
          )
          if (index === -1) return conversation

          const target = ensureLiveAssistantMessage(conversation.messages[index] as AssistantConversationMessage)
          conversation.messages[index] = recipe(target)
          return conversation
        })
      }

      const queue: Array<(message: LiveAssistantMessage) => LiveAssistantMessage> = []
      let scheduled = false
      const enqueueAssistantUpdate = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
        queue.push(recipe)
        if (scheduled) return
        scheduled = true
        window.requestAnimationFrame(() => {
          scheduled = false
          const jobs = queue.splice(0, queue.length)
          if (jobs.length === 0) return
          updateAssistantMessage((message) => jobs.reduce((current, job) => job(current), message))
        })
      }

      let receivedCompleteEvent = false
      await api.sendMessageStream(conversationIdForRequest, { content }, async (_eventType, event) => {
          switch (event.type) {
            case 'stage1_start':
              updateAssistantMessage((message) => ({
                ...message,
                loading: { stage1: true, stage2: message.loading.stage2, stage3: message.loading.stage3 },
              }))
              break
            case 'stage1_model_start':
              {
                const model = event.model
                enqueueAssistantUpdate((message) => ({
                  ...message,
                  stream: {
                    ...message.stream,
                    stage1: {
                      ...message.stream.stage1,
                      [model]: { response: '', thinking: '' },
                    },
                  },
                  streamMeta: {
                    ...message.streamMeta,
                    stage1: {
                      ...message.streamMeta.stage1,
                      [model]: { status: 'running' },
                    },
                  },
                }))
              }
              break
            case 'stage1_model_delta':
              {
                const { model, delta_type, text } = event
                enqueueAssistantUpdate((message) => {
                  const previous = message.stream.stage1[model] || { response: '', thinking: '' }
                  const next: Stage1StreamState = { ...previous }
                  if (delta_type === 'content') next.response += text || ''
                  if (delta_type === 'reasoning') next.thinking += text || ''
                  return {
                    ...message,
                    stream: {
                      ...message.stream,
                      stage1: { ...message.stream.stage1, [model]: next },
                    },
                  }
                })
              }
              break
            case 'stage1_model_error':
              {
                const { model, message: errorMessage } = event
                enqueueAssistantUpdate((message) => ({
                  ...message,
                  streamMeta: {
                    ...message.streamMeta,
                    stage1: {
                      ...message.streamMeta.stage1,
                      [model]: { status: 'error', message: errorMessage },
                    },
                  },
                }))
              }
              break
            case 'stage1_complete':
              {
                const { data } = event
                updateAssistantMessage((message) => ({
                  ...message,
                  stage1: data,
                  streamMeta: {
                    ...message.streamMeta,
                    stage1: Object.fromEntries(
                      Object.keys(message.streamMeta.stage1).map((model) => [
                        model,
                        {
                          status: data.some((result) => result.model === model)
                            ? 'complete'
                            : message.streamMeta.stage1[model]?.status || 'idle',
                        },
                      ]),
                    ) as Record<string, StreamStatusMeta>,
                  },
                  loading: { stage1: false, stage2: message.loading.stage2, stage3: message.loading.stage3 },
                }))
              }
              break
            case 'stage2_start':
              updateAssistantMessage((message) => ({
                ...message,
                loading: { stage1: message.loading.stage1, stage2: true, stage3: message.loading.stage3 },
              }))
              break
            case 'stage2_model_start':
              {
                const model = event.model
                enqueueAssistantUpdate((message) => ({
                  ...message,
                  stream: {
                    ...message.stream,
                    stage2: {
                      ...message.stream.stage2,
                      [model]: { ranking: '', thinking: '' },
                    },
                  },
                  streamMeta: {
                    ...message.streamMeta,
                    stage2: {
                      ...message.streamMeta.stage2,
                      [model]: { status: 'running' },
                    },
                  },
                }))
              }
              break
            case 'stage2_model_delta':
              {
                const { model, delta_type, text } = event
                enqueueAssistantUpdate((message) => {
                  const previous = message.stream.stage2[model] || { ranking: '', thinking: '' }
                  const next: Stage2StreamState = { ...previous }
                  if (delta_type === 'content') next.ranking += text || ''
                  if (delta_type === 'reasoning') next.thinking += text || ''
                  return {
                    ...message,
                    stream: {
                      ...message.stream,
                      stage2: { ...message.stream.stage2, [model]: next },
                    },
                  }
                })
              }
              break
            case 'stage2_model_error':
              {
                const { model, message: errorMessage } = event
                enqueueAssistantUpdate((message) => ({
                  ...message,
                  streamMeta: {
                    ...message.streamMeta,
                    stage2: {
                      ...message.streamMeta.stage2,
                      [model]: { status: 'error', message: errorMessage },
                    },
                  },
                }))
              }
              break
            case 'stage2_complete':
              {
                const { data, metadata } = event
                updateAssistantMessage((message) => ({
                  ...message,
                  stage2: data,
                  metadata,
                  streamMeta: {
                    ...message.streamMeta,
                    stage2: Object.fromEntries(
                      Object.keys(message.streamMeta.stage2).map((model) => [
                        model,
                        {
                          status: data.some((result) => result.model === model)
                            ? 'complete'
                            : message.streamMeta.stage2[model]?.status || 'idle',
                        },
                      ]),
                    ) as Record<string, StreamStatusMeta>,
                  },
                  loading: { stage1: message.loading.stage1, stage2: false, stage3: message.loading.stage3 },
                }))
              }
              break
            case 'stage3_start':
              updateAssistantMessage((message) => ({
                ...message,
              stream: {
                ...message.stream,
                stage3: { response: '', thinking: '' },
              },
                streamMeta: {
                  ...message.streamMeta,
                  stage3: { status: 'running' },
                },
                loading: { stage1: message.loading.stage1, stage2: message.loading.stage2, stage3: true },
              }))
              break
            case 'stage3_delta':
              {
                const { delta_type, text } = event
                enqueueAssistantUpdate((message) => {
                  const next: Stage3StreamState = { ...message.stream.stage3 }
                  if (delta_type === 'content') next.response += text || ''
                  if (delta_type === 'reasoning') next.thinking += text || ''
                  return {
                    ...message,
                    stream: {
                      ...message.stream,
                      stage3: next,
                    },
                  }
                })
              }
              break
            case 'stage3_error':
              {
                const errorMessage = event.message || 'Failed to complete final synthesis'
                enqueueAssistantUpdate((message) => ({
                  ...message,
                  streamMeta: {
                    ...message.streamMeta,
                    stage3: { status: 'error', message: errorMessage },
                  },
                }))
                lastProviderError.value = errorMessage
              }
              break
            case 'stage3_complete':
              {
                const { data } = event
                updateAssistantMessage((message) => ({
                  ...message,
                  stage3: data,
                  streamMeta: {
                    ...message.streamMeta,
                    stage3: { status: 'complete' },
                  },
                  loading: { stage1: message.loading.stage1, stage2: message.loading.stage2, stage3: false },
                }))
              }
              break
            case 'title_complete':
              {
                const title = event.data.title
                if (title) {
                  upsertConversationInSidebar({
                    id: conversationIdForRequest,
                    title,
                  })
                  updateCurrentConversation((conversation) => {
                    if (!conversation) return conversation
                    conversation.title = title
                    return conversation
                  })
                }
              }
              await loadConversations()
              break
          case 'complete':
            receivedCompleteEvent = true
            await loadConversations()
            isLoading.value = false
            break
            case 'error':
              lastProviderError.value = event.message || 'Failed to run MDT'
              isLoading.value = false
              break
        }
      })

      isRefreshingAfterStream.value = true
      await loadConversations()
      await loadConversation(conversationIdForRequest)
      isRefreshingAfterStream.value = false
      draftConversationId.value =
        draftConversationId.value === conversationIdForRequest ? null : draftConversationId.value
      if (!receivedCompleteEvent) {
        isLoading.value = false
      }
    } catch (error) {
      console.error('Failed to send message', error)
      lastProviderError.value = error instanceof Error ? error.message : String(error)
      updateCurrentConversation((conversation) => {
        if (!conversation) return conversation
        if (conversation.messages.length >= 2) {
          conversation.messages.splice(-2, 2)
        }
        return conversation
      })
      isLoading.value = false
      isRefreshingAfterStream.value = false
    }
  }

  watch([currentConversationId, isLoading, isRefreshingAfterStream], async ([conversationId, loading, refreshing]) => {
    if (conversationId && !loading && !refreshing) {
      await loadConversation(conversationId)
    }
  })

  onMounted(async () => {
    await Promise.all([loadConversations(), loadProviderSettings()])
  })

  return {
    conversations,
    currentConversation,
    currentConversationId,
    draftMessage,
    groupedConversations,
    isLoading,
    isSettingsOpen,
    isSidebarCollapsed,
    lastProviderError,
    providerConfigured,
    providerSettings,
    providerStatus,
    providerStatusText,
    runtimeConfig,
    settingsError,
    clearSettings,
    closeSettings,
    deleteConversation,
    loadConversations,
    newConversation,
    openSettings,
    renameConversation,
    saveSettings,
    selectConversation,
    sendMessage,
    toggleSidebar: () => {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    },
  }
}
