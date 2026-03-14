import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { api } from '@/api'
import { useI18n } from '@/i18n'
import type {
  AssistantConversationMessage,
  AssistantLoadingState,
  AssistantStreamMeta,
  AssistantStreamState,
  AppPreferences,
  ChatRunPreferences,
  Conversation,
  ConversationRunState,
  ConversationSummary,
  MdtRunConfig,
  PersistedConversationRun,
  ProjectSummary,
  ProviderSettings,
  ProviderSettingsInput,
  RuntimeConfig,
  Stage1StreamState,
  Stage2StreamState,
  Stage3StreamState,
  StreamStatusMeta,
  UserInputPayload,
} from '@/types'
import { isAbortError } from '@/utils'
import {
  cloneUserInputPayload,
  createEmptyUserInput,
  getAttachmentValidationMessage,
  hasUserInputContent,
  normalizeUserInputPayload,
} from '@/utils/attachments'
import {
  createRunConfig,
  getProviderStatusText,
  groupConversationsByDate,
  reconcileChatRunPreferences,
  toRuntimeConfig,
} from '@/utils/conversations'

const placeholderConversationTitles = new Set(['', 'New Conversation', 'Conversation', '新对话'])

const cloneValue = <T>(value: T): T => {
  const source = typeof value === 'object' && value !== null ? toRaw(value) : value

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(source)
  }

  return JSON.parse(JSON.stringify(source)) as T
}

type LiveAssistantMessage = AssistantConversationMessage & {
  stream: AssistantStreamState
  streamMeta: AssistantStreamMeta
  loading: AssistantLoadingState
}

const createStreamStatusMeta = (models: string[]) =>
  Object.fromEntries(models.map((model) => [model, { status: 'idle' as const }]))

const createAssistantMessage = (runConfig: MdtRunConfig): LiveAssistantMessage => ({
  id:
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `assistant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  role: 'assistant',
  stage1: null,
  stage2: null,
  stage3: null,
  metadata: null,
  runConfig,
  created_at: new Date().toISOString(),
  stream: {
    stage1: {},
    stage2: {},
    stage3: { response: '', thinking: '' },
  },
  streamMeta: {
    stage1: createStreamStatusMeta(runConfig.councilModels),
    stage2: createStreamStatusMeta(runConfig.councilModels),
    stage3: { status: 'idle' },
  },
  loading: {
    stage1: false,
    stage2: false,
    stage3: false,
  },
})

const createUserMessage = (input: UserInputPayload) => ({
  id:
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  role: 'user' as const,
  input: cloneUserInputPayload(input),
  created_at: new Date().toISOString(),
})

const createIdleRunState = (): ConversationRunState => ({
  requestId: null,
  status: 'idle',
  stage: null,
  startedAt: null,
  completedAt: null,
  lastActivityAt: null,
  lastError: '',
  hasUnreadUpdate: false,
  isRecovering: false,
})

const createConversationSnapshot = ({
  id,
  projectId,
  createdAt,
  title,
}: {
  id: string
  projectId: string
  createdAt: string
  title: string
}): Conversation => ({
  id,
  project_id: projectId,
  created_at: createdAt,
  title,
  messages: [],
})

const createRequestId = () =>
  (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
  `request_${Date.now()}_${Math.random().toString(16).slice(2)}`

const createFreshAssistantMessage = (assistantId: string, runConfig: MdtRunConfig, createdAt?: string) => ({
  ...createAssistantMessage(runConfig),
  id: assistantId,
  created_at: createdAt || new Date().toISOString(),
})

const markStatusMapAsIdle = (statuses: Record<string, StreamStatusMeta>) =>
  Object.fromEntries(
    Object.entries(statuses).map(([model, meta]) => [
      model,
      meta.status === 'running' ? { status: 'idle' as const } : meta,
    ]),
  ) as Record<string, StreamStatusMeta>

const markStatusMapAsError = (statuses: Record<string, StreamStatusMeta>, message: string) =>
  Object.fromEntries(
    Object.entries(statuses).map(([model, meta]) => [
      model,
      meta.status === 'complete' ? meta : { status: 'error' as const, message },
    ]),
  ) as Record<string, StreamStatusMeta>

const ensureLiveAssistantMessage = (message: AssistantConversationMessage): LiveAssistantMessage => ({
  ...message,
  runConfig: message.runConfig || null,
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

const getRunTimestamp = (state: ConversationRunState) =>
  new Date(state.lastActivityAt || state.completedAt || state.startedAt || 0).getTime()

const getLatestUserMessageIndex = (conversation: Conversation) => {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index]?.role === 'user') {
      return index
    }
  }

  return -1
}

const getLatestAssistantMessageIndex = (conversation: Conversation) => {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index]?.role === 'assistant') {
      return index
    }
  }

  return -1
}

export function useMdtApp() {
  const { locale, setLocale, t } = useI18n()
  const conversations = ref<ConversationSummary[]>([])
  const conversationCache = ref<Record<string, Conversation>>({})
  const conversationRunStates = ref<Record<string, ConversationRunState>>({})
  const persistedRuns = ref<Record<string, PersistedConversationRun>>({})
  const projects = ref<ProjectSummary[]>([])
  const currentConversationId = ref<string | null>(null)
  const currentProjectId = ref<string | null>(null)
  const draftMessage = ref<UserInputPayload>(createEmptyUserInput())
  const providerSettings = ref<ProviderSettings | null>(null)
  const isSettingsOpen = ref(false)
  const settingsError = ref('')
  const lastProviderError = ref('')
  const isSidebarCollapsed = ref(false)
  const hasHydratedPersistedRuns = ref(false)
  const isResumingPersistedRuns = ref(false)
  const hasLoadedAppPreferences = ref(false)
  const hasRestoredSelection = ref(false)
  const preferredProjectId = ref<string | null>(null)
  const preferredConversationId = ref<string | null>(null)
  const chatRunPreferences = ref<ChatRunPreferences>({
    targetStage: 'stage3',
    selectedCouncilModels: [],
  })
  const resumingRunIds = new Set<string>()
  const activeRunControllers = new Map<string, { requestId: string; controller: AbortController }>()

  const currentProject = computed(
    () => projects.value.find((project) => project.id === currentProjectId.value) || null,
  )
  const currentConversation = computed(() =>
    currentConversationId.value ? conversationCache.value[currentConversationId.value] || null : null,
  )
  const currentPersistedRun = computed(() =>
    currentConversationId.value ? persistedRuns.value[currentConversationId.value] || null : null,
  )
  const currentConversationRunState = computed(() =>
    currentConversationId.value
      ? conversationRunStates.value[currentConversationId.value] || createIdleRunState()
      : createIdleRunState(),
  )
  const currentConversationRunning = computed(() => currentConversationRunState.value.status === 'running')
  const currentConversationRecovering = computed(() => Boolean(currentConversationRunState.value.isRecovering))
  const currentConversationCanRetryRecovery = computed(
    () => Boolean(currentPersistedRun.value) && currentConversationRunState.value.status === 'error',
  )
  const currentConversationRecoveryError = computed(() =>
    currentConversationRunState.value.status === 'error'
      ? currentConversationRunState.value.lastError || currentPersistedRun.value?.lastError || ''
      : '',
  )
  const hasRunningConversations = computed(() =>
    Object.values(conversationRunStates.value).some((state) => state.status === 'running'),
  )
  const hasRecoveringConversations = computed(() =>
    Object.values(conversationRunStates.value).some((state) => state.status === 'running' && state.isRecovering),
  )
  const latestConversationError = computed(() => {
    const erroredStates = Object.values(conversationRunStates.value)
      .filter((state) => state.status === 'error' && state.lastError)
      .sort((left, right) => getRunTimestamp(right) - getRunTimestamp(left))

    return erroredStates[0]?.lastError || ''
  })
  const providerErrorMessage = computed(() => latestConversationError.value || lastProviderError.value)
  const suggestedProjectName = computed(() => buildProjectName())
  const runtimeConfig = computed<RuntimeConfig>(() => toRuntimeConfig(providerSettings.value))
  const availableCouncilModels = computed(() => runtimeConfig.value.council_models || [])
  const currentChatRunPreferences = computed<ChatRunPreferences>(() =>
    reconcileChatRunPreferences(chatRunPreferences.value, availableCouncilModels.value),
  )
  const currentRunConfig = computed<MdtRunConfig>(() =>
    createRunConfig(providerSettings.value, currentChatRunPreferences.value),
  )
  const groupedConversations = computed(() => groupConversationsByDate(conversations.value, locale.value))
  const providerConfigured = computed(() => runtimeConfig.value.configured)
  const providerStatus = computed<'ready' | 'running' | 'error' | 'unconfigured'>(() => {
    if (hasRunningConversations.value) return 'running'
    if (providerErrorMessage.value) return 'error'
    if (providerConfigured.value) return 'ready'
    return 'unconfigured'
  })
  const providerStatusText = computed(() => {
    if (hasRecoveringConversations.value || isResumingPersistedRuns.value) {
      return t('statusRecovering')
    }
    return getProviderStatusText(providerStatus.value, providerSettings.value, providerErrorMessage.value, locale.value)
  })

  const hasResolvedConversationTitle = (conversation?: Pick<Conversation, 'title'> | null) => {
    const trimmed = String(conversation?.title || '').trim()
    return Boolean(trimmed) && !placeholderConversationTitles.has(trimmed)
  }

  const isMatchingRequest = (conversationId: string, requestId: string) =>
    conversationRunStates.value[conversationId]?.requestId === requestId

  const isActiveRequest = (conversationId: string, requestId: string) =>
    isMatchingRequest(conversationId, requestId) && conversationRunStates.value[conversationId]?.status === 'running'

  const getConversationSummary = (conversationId: string) =>
    conversations.value.find((entry) => entry.id === conversationId) || null

  const getRunState = (conversationId: string) => conversationRunStates.value[conversationId] || createIdleRunState()

  const getRunAttachmentValidationMessage = (input: UserInputPayload, runConfig: MdtRunConfig) => {
    return getAttachmentValidationMessage(input, runConfig.councilModels, locale.value)
  }

  const getLatestAssistantMessageId = (conversationId: string) => {
    const conversation = conversationCache.value[conversationId]
    if (!conversation) return null

    const assistantIndex = getLatestAssistantMessageIndex(conversation)
    if (assistantIndex < 0) return null

    const message = conversation.messages[assistantIndex]
    return message?.role === 'assistant' ? message.id || null : null
  }

  const setConversationInCache = (conversation: Conversation) => {
    conversationCache.value[conversation.id] = cloneValue(conversation)
    return conversationCache.value[conversation.id]!
  }

  const cachePersistedRun = (run: PersistedConversationRun) => {
    persistedRuns.value[run.conversationId] = cloneValue(run)
    return persistedRuns.value[run.conversationId]!
  }

  const removeConversationFromCache = (conversationId: string) => {
    if (!(conversationId in conversationCache.value)) return
    const nextCache = { ...conversationCache.value }
    delete nextCache[conversationId]
    conversationCache.value = nextCache
  }

  const removeConversationRunState = (conversationId: string) => {
    if (!(conversationId in conversationRunStates.value)) return
    const nextStates = { ...conversationRunStates.value }
    delete nextStates[conversationId]
    conversationRunStates.value = nextStates
  }

  const removePersistedRunFromCache = (conversationId: string) => {
    if (!(conversationId in persistedRuns.value)) return
    const nextRuns = { ...persistedRuns.value }
    delete nextRuns[conversationId]
    persistedRuns.value = nextRuns
  }

  const updateConversationById = (
    conversationId: string,
    updater: (conversation: Conversation | null) => Conversation | null,
  ) => {
    const current = conversationCache.value[conversationId] ? cloneValue(conversationCache.value[conversationId]) : null
    const next = updater(current)
    if (!next) {
      removeConversationFromCache(conversationId)
      return null
    }
    conversationCache.value[conversationId] = next
    return next
  }

  const updateAssistantMessageInConversation = (
    conversationId: string,
    assistantMessageId: string,
    recipe: (message: LiveAssistantMessage) => LiveAssistantMessage,
  ) => {
    updateConversationById(conversationId, (conversation) => {
      if (!conversation) return conversation
      const index = conversation.messages.findIndex(
        (message) => message.role === 'assistant' && message.id === assistantMessageId,
      )
      if (index === -1) return conversation

      const target = ensureLiveAssistantMessage(conversation.messages[index] as AssistantConversationMessage)
      conversation.messages[index] = recipe(target)
      return conversation
    })
  }

  const updateConversationRunState = (
    conversationId: string,
    recipe: (state: ConversationRunState) => ConversationRunState,
  ) => {
    const next = recipe({ ...createIdleRunState(), ...cloneValue(getRunState(conversationId)) })
    conversationRunStates.value[conversationId] = next
    return next
  }

  const clearConversationUnread = (conversationId: string) => {
    if (!(conversationId in conversationRunStates.value)) return
    updateConversationRunState(conversationId, (state) => ({ ...state, hasUnreadUpdate: false }))
  }

  const touchConversationActivity = (
    conversationId: string,
    requestId: string,
    updates: Partial<ConversationRunState> = {},
  ) => {
    if (!isActiveRequest(conversationId, requestId)) return
    const now = new Date().toISOString()
    updateConversationRunState(conversationId, (state) => ({
      ...state,
      ...updates,
      lastActivityAt: now,
      isRecovering:
        typeof updates.isRecovering === 'boolean' ? updates.isRecovering : Boolean(state.isRecovering),
      hasUnreadUpdate:
        typeof updates.hasUnreadUpdate === 'boolean'
          ? updates.hasUnreadUpdate
          : currentConversationId.value === conversationId
            ? false
            : true,
    }))
  }

  const savePersistedRun = async (run: PersistedConversationRun) => {
    const saved = await api.saveConversationRun(run)
    return cachePersistedRun(saved)
  }

  const deletePersistedRun = async (conversationId: string) => {
    removePersistedRunFromCache(conversationId)
    await api.deleteConversationRun(conversationId)
  }

  const persistCachedConversation = async (conversationId: string) => {
    const conversation = conversationCache.value[conversationId]
    if (!conversation) return null
    const saved = await api.saveConversation(conversation)
    return setConversationInCache(saved)
  }

  const setActiveRunController = (conversationId: string, requestId: string, controller: AbortController) => {
    activeRunControllers.set(conversationId, { requestId, controller })
  }

  const clearActiveRunController = (conversationId: string, requestId: string) => {
    const current = activeRunControllers.get(conversationId)
    if (current?.requestId === requestId) {
      activeRunControllers.delete(conversationId)
    }
  }

  const syncPersistedRunProgress = (
    conversationId: string,
    requestId: string,
    updates: Partial<PersistedConversationRun>,
  ) => {
    const current = persistedRuns.value[conversationId]
    if (!current || current.requestId !== requestId) return

    const next: PersistedConversationRun = {
      ...current,
      ...updates,
      updatedAt: String(updates.updatedAt || new Date().toISOString()),
    }
    cachePersistedRun(next)
    void api.saveConversationRun(next)
  }

  const markConversationStoppedState = (
    conversationId: string,
    requestId: string,
    assistantMessageId = persistedRuns.value[conversationId]?.assistantMessageId || getLatestAssistantMessageId(conversationId),
  ) => {
    if (!isMatchingRequest(conversationId, requestId)) return

    if (assistantMessageId) {
      updateAssistantMessageInConversation(conversationId, assistantMessageId, (message) => ({
        ...message,
        streamMeta: {
          stage1: markStatusMapAsIdle(message.streamMeta.stage1),
          stage2: markStatusMapAsIdle(message.streamMeta.stage2),
          stage3: message.streamMeta.stage3.status === 'running' ? { status: 'idle' } : message.streamMeta.stage3,
        },
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      }))
    }

    const now = new Date().toISOString()
    updateConversationRunState(conversationId, (state) => ({
      ...state,
      status: 'stopped',
      completedAt: now,
      lastActivityAt: now,
      lastError: '',
      hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
      isRecovering: false,
    }))
    syncPersistedRunProgress(conversationId, requestId, {
      status: 'stopped',
      updatedAt: now,
      lastError: '',
    })
  }

  const deletePersistedRunIfSettled = async (conversationId: string) => {
    const persistedRun = persistedRuns.value[conversationId]
    if (!persistedRun) return
    if (getRunState(conversationId).status !== 'complete') return

    await deletePersistedRun(conversationId).catch((error) => {
      console.error('Failed to clear persisted run', error)
    })
  }

  const loadProjects = async () => {
    try {
      const nextProjects = await api.listProjects()
      projects.value = nextProjects

      if (!nextProjects.length) {
        currentProjectId.value = null
        conversations.value = []
        return nextProjects
      }

      if (!currentProjectId.value || !nextProjects.some((project) => project.id === currentProjectId.value)) {
        currentProjectId.value = nextProjects[0]!.id
      }

      return nextProjects
    } catch (error) {
      console.error('Failed to load projects', error)
      return []
    }
  }

  const loadConversations = async (projectId = currentProjectId.value) => {
    try {
      if (!projectId) {
        if (!currentProjectId.value) {
          conversations.value = []
        }
        return []
      }

      const nextConversations = await api.listConversations(projectId)
      if (projectId === currentProjectId.value) {
        conversations.value = nextConversations
      }
      return nextConversations
    } catch (error) {
      console.error('Failed to load conversations', error)
      return []
    }
  }

  const loadProviderSettings = async () => {
    try {
      providerSettings.value = await api.getProviderSettings()
    } catch (error) {
      console.error('Failed to load provider settings', error)
      lastProviderError.value = t('errorLoadLocalSettings')
    }
  }

  const loadAppPreferences = async () => {
    try {
      const preferences = await api.getAppPreferences()
      setLocale(preferences.locale)
      preferredProjectId.value = preferences.lastProjectId || null
      preferredConversationId.value = preferences.lastConversationId || null
      chatRunPreferences.value = {
        targetStage: preferences.chatTargetStage || 'stage3',
        selectedCouncilModels: preferences.chatSelectedCouncilModels || [],
      }
      if (preferredProjectId.value) {
        currentProjectId.value = preferredProjectId.value
      }
      hasLoadedAppPreferences.value = true
    } catch (error) {
      console.error('Failed to load app preferences', error)
      hasLoadedAppPreferences.value = true
    }
  }

  const saveAppPreferences = async (input: Partial<AppPreferences>) => {
    try {
      const saved = await api.saveAppPreferences(input)
      preferredProjectId.value = saved.lastProjectId || null
      preferredConversationId.value = saved.lastConversationId || null
      chatRunPreferences.value = {
        targetStage: saved.chatTargetStage || 'stage3',
        selectedCouncilModels: saved.chatSelectedCouncilModels || [],
      }
      return saved
    } catch (error) {
      console.error('Failed to save app preferences', error)
      return null
    }
  }

  const setAppLocale = async (nextLocale: 'zh-CN' | 'en') => {
    const saved = await saveAppPreferences({ locale: nextLocale })
    setLocale(saved?.locale || nextLocale)
  }

  const persistChatRunPreferences = async (nextPreferences: ChatRunPreferences) => {
    chatRunPreferences.value = nextPreferences
    if (!hasLoadedAppPreferences.value) return nextPreferences

    const saved = await saveAppPreferences({
      chatTargetStage: nextPreferences.targetStage,
      chatSelectedCouncilModels: nextPreferences.selectedCouncilModels,
    })

    return saved
      ? {
          targetStage: saved.chatTargetStage || nextPreferences.targetStage,
          selectedCouncilModels: saved.chatSelectedCouncilModels || nextPreferences.selectedCouncilModels,
        }
      : nextPreferences
  }

  const setChatTargetStage = async (targetStage: ChatRunPreferences['targetStage']) => {
    const nextPreferences = reconcileChatRunPreferences(
      {
        ...chatRunPreferences.value,
        targetStage,
      },
      availableCouncilModels.value,
    )
    await persistChatRunPreferences(nextPreferences)
  }

  const toggleChatCouncilModel = async (model: string) => {
    const selected = new Set(currentChatRunPreferences.value.selectedCouncilModels)
    if (selected.has(model)) {
      if (selected.size === 1) return
      selected.delete(model)
    } else {
      selected.add(model)
    }

    await persistChatRunPreferences(
      reconcileChatRunPreferences(
        {
          ...chatRunPreferences.value,
          selectedCouncilModels: [...selected],
        },
        availableCouncilModels.value,
      ),
    )
  }

  const selectAllChatCouncilModels = async () => {
    await persistChatRunPreferences(
      reconcileChatRunPreferences(
        {
          ...chatRunPreferences.value,
          selectedCouncilModels: availableCouncilModels.value,
        },
        availableCouncilModels.value,
      ),
    )
  }

  const resetChatRunPreferences = async () => {
    await persistChatRunPreferences(
      reconcileChatRunPreferences(
        {
          targetStage: 'stage3',
          selectedCouncilModels: availableCouncilModels.value,
        },
        availableCouncilModels.value,
      ),
    )
  }

  const resolveStoredRunConfig = (
    rawRunConfig?: MdtRunConfig | null,
    fallback?: Partial<MdtRunConfig> | null,
  ) => createRunConfig(providerSettings.value, rawRunConfig || fallback || currentRunConfig.value)

  const loadConversation = async (conversationId: string, options: { force?: boolean } = {}) => {
    const cached = conversationCache.value[conversationId]
    const runState = conversationRunStates.value[conversationId]

    if (!options.force && cached && runState?.status === 'running') {
      return cached
    }

    try {
      const conversation = await api.getConversation(conversationId)
      return setConversationInCache(conversation)
    } catch (error) {
      console.error('Failed to load conversation', error)
      return conversationCache.value[conversationId] || null
    }
  }

  const upsertConversationInSidebar = (
    conversation: Partial<ConversationSummary> & Pick<ConversationSummary, 'id' | 'project_id'>,
  ) => {
    const activeProjectId = currentProjectId.value
    if (!activeProjectId || conversation.project_id !== activeProjectId) {
      return
    }

    conversations.value = (() => {
      const list = Array.isArray(conversations.value) ? [...conversations.value] : []
      const index = list.findIndex((entry) => entry.id === conversation.id)
      if (index === -1) {
        list.unshift({
          id: conversation.id,
          project_id: conversation.project_id,
          created_at: conversation.created_at || new Date().toISOString(),
          title: conversation.title || '',
          message_count: conversation.message_count ?? 0,
        })
      } else {
        const existing = list[index]!
        list[index] = {
          id: conversation.id,
          project_id: conversation.project_id,
          created_at: conversation.created_at || existing.created_at,
          title: conversation.title ?? existing.title,
          message_count: conversation.message_count ?? existing.message_count,
        }
      }

      return list.sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      )
    })()
  }

  const buildProjectName = () => {
    const names = new Set(projects.value.map((project) => project.name))
    let count = Math.max(projects.value.length, 1)
    let candidate = t('projectAutoName', { count })

    while (names.has(candidate)) {
      count += 1
      candidate = t('projectAutoName', { count })
    }

    return candidate
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
      providerSettings.value = await api.saveProviderSettings(settings, locale.value)
      settingsError.value = ''
      lastProviderError.value = ''
      isSettingsOpen.value = false
      void resumePersistedRuns()
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

  const resetDraftState = () => {
    currentConversationId.value = null
    draftMessage.value = createEmptyUserInput()
  }

  const goHome = () => {
    resetDraftState()
  }

  const newConversation = () => {
    goHome()
  }

  const removeProjectArtifacts = async (projectId: string) => {
    const nextCache = { ...conversationCache.value }
    const nextRunStates = { ...conversationRunStates.value }

    for (const [conversationId, conversation] of Object.entries(conversationCache.value)) {
      if (conversation.project_id === projectId) {
        activeRunControllers.get(conversationId)?.controller.abort()
        activeRunControllers.delete(conversationId)
        delete nextCache[conversationId]
        delete nextRunStates[conversationId]
        resumingRunIds.delete(conversationId)
      }
    }

    conversationCache.value = nextCache
    conversationRunStates.value = nextRunStates

    for (const [conversationId, run] of Object.entries(persistedRuns.value)) {
      if (run.projectId === projectId) {
        removePersistedRunFromCache(conversationId)
      }
    }

    await api.deleteConversationRunsByProject(projectId)
  }

  const createProject = async (name: string) => {
    const nextName = String(name || '').trim()
    if (!nextName) return

    try {
      const created = await api.createProject(nextName)
      await loadProjects()
      currentProjectId.value = created.id
      goHome()
    } catch (error) {
      console.error('Failed to create project', error)
    }
  }

  const renameProject = async (projectId: string, name: string) => {
    try {
      await api.renameProject(projectId, name)
      await loadProjects()
    } catch (error) {
      console.error('Failed to rename project', error)
    }
  }

  const deleteProject = async (projectId: string) => {
    try {
      const wasCurrentProject = currentProjectId.value === projectId
      const result = await api.deleteProject(projectId)
      await removeProjectArtifacts(projectId)
      await loadProjects()

      if (wasCurrentProject || !projects.value.some((project) => project.id === currentProjectId.value)) {
        currentProjectId.value = result.nextProjectId
        goHome()
      }

      await loadConversations(currentProjectId.value)
    } catch (error) {
      console.error('Failed to delete project', error)
    }
  }

  const deleteConversation = async (conversationId: string) => {
    try {
      stopConversation(conversationId)
      await api.deleteConversation(conversationId)
      await deletePersistedRun(conversationId).catch(() => undefined)
      resumingRunIds.delete(conversationId)
      removeConversationFromCache(conversationId)
      removeConversationRunState(conversationId)
      if (currentConversationId.value === conversationId) {
        newConversation()
      }
      await loadConversations(currentProjectId.value)
      await loadProjects()
    } catch (error) {
      console.error('Failed to delete conversation', error)
    }
  }

  const renameConversation = async (conversationId: string, title: string) => {
    try {
      await api.renameConversation(conversationId, title)
      upsertConversationInSidebar({
        id: conversationId,
        project_id:
          conversationCache.value[conversationId]?.project_id ||
          getConversationSummary(conversationId)?.project_id ||
          currentProjectId.value ||
          '',
        title,
      })
      updateConversationById(conversationId, (conversation) => {
        if (!conversation) return conversation
        conversation.title = title
        return conversation
      })
      await loadConversations(currentProjectId.value)
      if (conversationRunStates.value[conversationId]?.status !== 'running') {
        await loadConversation(conversationId, { force: true })
      }
    } catch (error) {
      console.error('Failed to rename conversation', error)
    }
  }

  const selectConversation = (conversationId: string) => {
    currentConversationId.value = conversationId
    clearConversationUnread(conversationId)
  }

  const selectProject = (projectId: string) => {
    if (currentProjectId.value === projectId) return
    currentProjectId.value = projectId
    goHome()
  }

  const ensureConversationForSend = async ({ activate = true }: { activate?: boolean } = {}) => {
    if (currentConversationId.value) {
      const cachedConversation = conversationCache.value[currentConversationId.value]
      if (cachedConversation) {
        return cloneValue(cachedConversation)
      }

      const loadedConversation = await loadConversation(currentConversationId.value, { force: true })
      if (loadedConversation) {
        return cloneValue(loadedConversation)
      }
    }

    if (!currentProjectId.value) {
      await loadProjects()
    }

    if (!currentProjectId.value) {
      throw new Error(t('errorNoProjectAvailable'))
    }

    const conversation = await api.createConversationForProject(currentProjectId.value, t('conversationUntitled'))
    setConversationInCache(conversation)
    if (activate) {
      currentConversationId.value = conversation.id
      upsertConversationInSidebar({
        id: conversation.id,
        project_id: conversation.project_id,
        created_at: conversation.created_at,
        title: conversation.title,
        message_count: conversation.messages.length,
      })
      await loadProjects()
    }
    return cloneValue(conversation)
  }

  const buildPersistedRun = ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    userMessageId,
    input,
    runConfig,
    shouldGenerateTitle,
    startedAt,
  }: {
    conversationId: string
    projectId: string
    requestId: string
    assistantMessageId: string
    userMessageId: string
    input: UserInputPayload
    runConfig: MdtRunConfig
    shouldGenerateTitle: boolean
    startedAt: string
  }): PersistedConversationRun => ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    userMessageId,
    input: cloneUserInputPayload(input),
    locale: locale.value,
    runConfig,
    shouldGenerateTitle,
    startedAt,
    updatedAt: startedAt,
    stage: 'stage1',
    status: 'running',
    lastError: '',
  })

  const createRunningAssistantPlaceholder = (
    runConfig: MdtRunConfig,
    assistantMessageId = createRequestId(),
    assistantCreatedAt?: string,
  ) => {
    const assistantMessage = createFreshAssistantMessage(assistantMessageId, runConfig, assistantCreatedAt)
    assistantMessage.loading = {
      stage1: true,
      stage2: false,
      stage3: false,
    }
    return assistantMessage
  }

  const launchConversationRun = async ({
    conversationId,
    projectId,
    assistantMessageId,
    assistantMessageCreatedAt,
    userMessageId,
    input,
    runConfig,
    shouldGenerateTitle,
    messageLocale,
  }: {
    conversationId: string
    projectId: string
    assistantMessageId: string
    assistantMessageCreatedAt?: string
    userMessageId: string
    input: UserInputPayload
    runConfig: MdtRunConfig
    shouldGenerateTitle: boolean
    messageLocale: 'zh-CN' | 'en'
  }) => {
    const requestId = createRequestId()
    const startedAt = new Date().toISOString()
    const persistedRun = buildPersistedRun({
      conversationId,
      projectId,
      requestId,
      assistantMessageId,
      userMessageId,
      input,
      runConfig,
      shouldGenerateTitle,
      startedAt,
    })

    try {
      await savePersistedRun(persistedRun)
    } catch (error) {
      console.error('Failed to save persisted run', error)
      return false
    }

    conversationRunStates.value[conversationId] = {
      requestId,
      status: 'running',
      stage: 'stage1',
      startedAt,
      completedAt: null,
      lastActivityAt: startedAt,
      lastError: '',
      hasUnreadUpdate: false,
      isRecovering: false,
    }

    void runConversationTask({
      conversationId,
      projectId,
      requestId,
      assistantMessageId,
      assistantMessageCreatedAt,
      input,
      runConfig,
      shouldGenerateTitle,
      messageLocale,
    })

    return true
  }

  const rehydrateRunState = (run: PersistedConversationRun) => {
    const current = getRunState(run.conversationId)
    updateConversationRunState(run.conversationId, () => ({
      requestId: run.requestId,
      status:
        run.status === 'complete'
          ? 'complete'
          : run.status === 'error'
            ? 'error'
            : run.status === 'stopped'
              ? 'stopped'
              : 'running',
      stage: run.stage,
      startedAt: run.startedAt,
      completedAt: run.status === 'running' ? null : run.updatedAt,
      lastActivityAt: run.updatedAt,
      lastError: run.lastError || current.lastError || '',
      hasUnreadUpdate: currentConversationId.value === run.conversationId ? false : true,
      isRecovering: run.status === 'running',
    }))
  }

  const prepareAssistantPlaceholder = async ({
    conversationId,
    assistantMessageId,
    runConfig,
    assistantCreatedAt,
  }: {
    conversationId: string
    assistantMessageId: string
    runConfig: MdtRunConfig
    assistantCreatedAt?: string
  }) => {
    const nextConversation = updateConversationById(conversationId, (conversation) => {
      if (!conversation) return conversation
      const placeholderIndex = conversation.messages.findIndex(
        (message) => message.role === 'assistant' && message.id === assistantMessageId,
      )
      const freshAssistant = createFreshAssistantMessage(assistantMessageId, runConfig, assistantCreatedAt)

      if (placeholderIndex >= 0) {
        conversation.messages[placeholderIndex] = freshAssistant
      } else {
        conversation.messages.push(freshAssistant)
      }

      return conversation
    })

    if (nextConversation) {
      await api.saveConversation(nextConversation)
    }
  }

  const hydratePersistedRuns = async () => {
    try {
      const runs = await api.listConversationRuns()
      const nextRuns: Record<string, PersistedConversationRun> = {}

      for (const run of runs) {
        try {
          const conversation = await api.getConversation(run.conversationId)
          setConversationInCache(conversation)
          nextRuns[run.conversationId] = run
          rehydrateRunState(run)
        } catch {
          await api.deleteConversationRun(run.conversationId)
        }
      }

      persistedRuns.value = nextRuns
      hasHydratedPersistedRuns.value = true
    } catch (error) {
      console.error('Failed to hydrate persisted runs', error)
      hasHydratedPersistedRuns.value = true
    }
  }

  const syncConversationAfterRun = async (conversationId: string, projectId: string, requestId: string) => {
    try {
      if (getRunState(conversationId).status === 'stopped') {
        await persistCachedConversation(conversationId)
      }
      if (projectId === currentProjectId.value) {
        await loadConversations(projectId)
      }
      await loadConversation(conversationId, { force: true })
      await loadProjects()
    } catch (error) {
      console.error('Failed to refresh conversation after run', error)
    } finally {
      resumingRunIds.delete(conversationId)

      if (isActiveRequest(conversationId, requestId)) {
        const state = getRunState(conversationId)
        if (state.status === 'running') {
          const now = new Date().toISOString()
          const errorMessage = state.lastError || t('orchestratorRunFailed')
          updateConversationRunState(conversationId, (current) => ({
            ...current,
            status: 'error',
            completedAt: now,
            lastActivityAt: now,
            lastError: errorMessage,
            hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
            isRecovering: false,
          }))
          syncPersistedRunProgress(conversationId, requestId, {
            status: 'error',
            updatedAt: now,
            lastError: errorMessage,
          })
        }
      }

      await deletePersistedRunIfSettled(conversationId)
    }
  }

  const runConversationTask = async ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    assistantMessageCreatedAt,
    input,
    runConfig,
    shouldGenerateTitle,
    messageLocale,
  }: {
    conversationId: string
    projectId: string
    requestId: string
    assistantMessageId: string
    assistantMessageCreatedAt?: string
    input: UserInputPayload
    runConfig: MdtRunConfig
    shouldGenerateTitle: boolean
    messageLocale: 'zh-CN' | 'en'
  }) => {
    const updateAssistantMessage = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
      if (!isMatchingRequest(conversationId, requestId)) return
      updateAssistantMessageInConversation(conversationId, assistantMessageId, recipe)
    }

    const setAssistantErrorState = (errorMessage: string) => {
      const nextErrorMessage = String(errorMessage || t('orchestratorRunFailed')).trim() || t('orchestratorRunFailed')

      updateAssistantMessage((message) => ({
        ...message,
        stage3:
          runConfig.targetStage === 'stage3'
            ? message.stage3 || {
                model: runConfig.chairmanModel || 'chairman',
                response: message.stream.stage3.response || nextErrorMessage,
                reasoning_details: null,
              }
            : null,
        stream: {
          ...message.stream,
          stage3: {
            response: message.stream.stage3.response || nextErrorMessage,
            thinking: message.stream.stage3.thinking,
          },
        },
        streamMeta: {
          stage1: markStatusMapAsError(message.streamMeta.stage1, nextErrorMessage),
          stage2: markStatusMapAsError(message.streamMeta.stage2, nextErrorMessage),
          stage3:
            runConfig.targetStage === 'stage3' ? { status: 'error', message: nextErrorMessage } : { status: 'idle' },
        },
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      }))
    }

    const queue: Array<(message: LiveAssistantMessage) => LiveAssistantMessage> = []
    let scheduled = false
    const flushAssistantUpdates = () => {
      if (!isMatchingRequest(conversationId, requestId)) return
      const jobs = queue.splice(0, queue.length)
      if (jobs.length === 0) return
      updateAssistantMessage((message) => jobs.reduce((current, job) => job(current), message))
    }
    const enqueueAssistantUpdate = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
      queue.push(recipe)
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(() => {
        scheduled = false
        flushAssistantUpdates()
      })
    }

    const markConversationStopped = () => {
      if (!isMatchingRequest(conversationId, requestId)) return
      flushAssistantUpdates()
      markConversationStoppedState(conversationId, requestId, assistantMessageId)
    }

    const abortController = new AbortController()
    setActiveRunController(conversationId, requestId, abortController)

    try {
      await api.sendMessageStream(
        conversationId,
        { input, locale: messageLocale },
        async (_eventType, event) => {
          if (!isMatchingRequest(conversationId, requestId)) return
          if (event.type !== 'stopped' && !isActiveRequest(conversationId, requestId)) return

          switch (event.type) {
            case 'stage1_start':
              updateAssistantMessage((message) => ({
                ...message,
                loading: { stage1: true, stage2: message.loading.stage2, stage3: message.loading.stage3 },
              }))
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage1', lastError: '' })
              syncPersistedRunProgress(conversationId, requestId, { stage: 'stage1', status: 'running' })
              break
            case 'stage1_model_start': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage1' })
              break
            }
            case 'stage1_model_delta': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage1' })
              break
            }
            case 'stage1_model_error': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage1' })
              break
            }
            case 'stage1_complete': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage1' })
              break
            }
            case 'stage2_start':
              updateAssistantMessage((message) => ({
                ...message,
                loading: { stage1: message.loading.stage1, stage2: true, stage3: message.loading.stage3 },
              }))
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage2' })
              syncPersistedRunProgress(conversationId, requestId, { stage: 'stage2', status: 'running' })
              break
            case 'stage2_model_start': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage2' })
              break
            }
            case 'stage2_model_delta': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage2' })
              break
            }
            case 'stage2_model_error': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage2' })
              break
            }
            case 'stage2_complete': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage2' })
              break
            }
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage3' })
              syncPersistedRunProgress(conversationId, requestId, { stage: 'stage3', status: 'running' })
              break
            case 'stage3_delta': {
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
              touchConversationActivity(conversationId, requestId, { status: 'running', stage: 'stage3' })
              break
            }
            case 'stage3_error': {
              const errorMessage = event.message || t('orchestratorFinalSynthesisFailed')
              enqueueAssistantUpdate((message) => ({
                ...message,
                streamMeta: {
                  ...message.streamMeta,
                  stage3: { status: 'error', message: errorMessage },
                },
              }))
              lastProviderError.value = errorMessage
              touchConversationActivity(conversationId, requestId, {
                status: 'error',
                stage: 'stage3',
                lastError: errorMessage,
                completedAt: new Date().toISOString(),
              })
              syncPersistedRunProgress(conversationId, requestId, {
                status: 'error',
                lastError: errorMessage,
              })
              break
            }
            case 'stage3_complete': {
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
              touchConversationActivity(conversationId, requestId, {
                status: getRunState(conversationId).status === 'error' ? 'error' : 'running',
                stage: 'stage3',
              })
              break
            }
            case 'title_complete': {
              const title = event.data.title
              if (title) {
                upsertConversationInSidebar({
                  id: conversationId,
                  project_id: projectId,
                  title,
                })
                updateConversationById(conversationId, (conversation) => {
                  if (!conversation) return conversation
                  conversation.title = title
                  return conversation
                })
              }
              if (projectId === currentProjectId.value) {
                void loadConversations(projectId)
              }
              break
            }
            case 'complete': {
              const now = new Date().toISOString()
              updateConversationRunState(conversationId, (state) => ({
                ...state,
                status: state.status === 'error' ? 'error' : 'complete',
                stage: runConfig.targetStage,
                completedAt: now,
                lastActivityAt: now,
                hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
                isRecovering: false,
              }))
              syncPersistedRunProgress(conversationId, requestId, {
                status: 'complete',
                updatedAt: now,
                stage: runConfig.targetStage,
                lastError: '',
              })
              if (getRunState(conversationId).status !== 'error') {
                lastProviderError.value = ''
              }
              break
            }
            case 'error': {
              const errorMessage = event.message || t('orchestratorRunFailed')
              lastProviderError.value = errorMessage
              setAssistantErrorState(errorMessage)
              const now = new Date().toISOString()
              updateConversationRunState(conversationId, (state) => ({
                ...state,
                status: 'error',
                completedAt: now,
                lastActivityAt: now,
                lastError: errorMessage,
                hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
                isRecovering: false,
              }))
              syncPersistedRunProgress(conversationId, requestId, {
                status: 'error',
                updatedAt: now,
                lastError: errorMessage,
              })
              break
            }
            case 'stopped':
              markConversationStopped()
              break
          }
        },
        {
          persistUserMessage: false,
          shouldGenerateTitle,
          assistantMessageId,
          assistantMessageCreatedAt,
          runConfig,
          signal: abortController.signal,
        },
      )
    } catch (error) {
      if (!isMatchingRequest(conversationId, requestId)) return
      if (isAbortError(error)) {
        markConversationStopped()
        return
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      lastProviderError.value = errorMessage
      setAssistantErrorState(errorMessage)
      const now = new Date().toISOString()
      updateConversationRunState(conversationId, (state) => ({
        ...state,
        status: 'error',
        completedAt: now,
        lastActivityAt: now,
        lastError: errorMessage,
        hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
        isRecovering: false,
      }))
      syncPersistedRunProgress(conversationId, requestId, {
        status: 'error',
        updatedAt: now,
        lastError: errorMessage,
      })
    } finally {
      flushAssistantUpdates()
      clearActiveRunController(conversationId, requestId)
      await syncConversationAfterRun(conversationId, projectId, requestId)
    }
  }

  const resumePersistedRuns = async (targetConversationIds?: string[], options?: { includeErrored?: boolean }) => {
    if (!hasHydratedPersistedRuns.value || !providerConfigured.value || isResumingPersistedRuns.value) {
      return
    }

    const recoverableRuns = Object.values(persistedRuns.value).filter((run) => {
      const isTargeted = !targetConversationIds || targetConversationIds.includes(run.conversationId)
      const isRecoverableStatus =
        run.status === 'running' || (options?.includeErrored ? run.status === 'error' : false)
      return isTargeted && isRecoverableStatus
    })
    if (recoverableRuns.length === 0) return

    isResumingPersistedRuns.value = true

    try {
      await Promise.all(
        recoverableRuns.map(async (run) => {
          if (resumingRunIds.has(run.conversationId)) return
          resumingRunIds.add(run.conversationId)

          let conversation = conversationCache.value[run.conversationId]
          if (!conversation) {
            try {
              conversation = await api.getConversation(run.conversationId)
              setConversationInCache(conversation)
            } catch (error) {
              console.error('Failed to load conversation for run recovery', error)
              resumingRunIds.delete(run.conversationId)
              await deletePersistedRun(run.conversationId).catch(() => undefined)
              removeConversationRunState(run.conversationId)
              return
            }
          }

          const existingAssistantMessage = conversation.messages.find(
            (message) => message.role === 'assistant' && message.id === run.assistantMessageId,
          ) as AssistantConversationMessage | undefined
          const runConfig = resolveStoredRunConfig(run.runConfig, {
            ...(existingAssistantMessage?.runConfig || {}),
            targetStage: run.stage === 'stage1' || run.stage === 'stage2' || run.stage === 'stage3' ? run.stage : 'stage3',
          })
          const runInput = normalizeUserInputPayload(run.input)
          const validationMessage = getRunAttachmentValidationMessage(runInput, runConfig)

          if (validationMessage) {
            const now = new Date().toISOString()
            updateConversationRunState(run.conversationId, (state) => ({
              ...state,
              requestId: run.requestId,
              status: 'error',
              stage: run.stage || 'stage1',
              startedAt: run.startedAt,
              completedAt: now,
              lastActivityAt: now,
              lastError: validationMessage,
              hasUnreadUpdate: currentConversationId.value === run.conversationId ? false : true,
              isRecovering: false,
            }))
            await syncPersistedRunProgress(run.conversationId, run.requestId, {
              status: 'error',
              updatedAt: now,
              lastError: validationMessage,
            })
            resumingRunIds.delete(run.conversationId)
            return
          }

          await prepareAssistantPlaceholder({
            conversationId: run.conversationId,
            assistantMessageId: run.assistantMessageId,
            runConfig,
            assistantCreatedAt:
              existingAssistantMessage?.created_at || run.startedAt,
          })

          const shouldGenerateTitle = run.shouldGenerateTitle && !hasResolvedConversationTitle(conversation)
          rehydrateRunState(run)

          void runConversationTask({
            conversationId: run.conversationId,
            projectId: run.projectId,
            requestId: run.requestId,
            assistantMessageId: run.assistantMessageId,
            assistantMessageCreatedAt:
              existingAssistantMessage?.created_at || run.startedAt,
            input: runInput,
            runConfig,
            shouldGenerateTitle,
            messageLocale: run.locale,
          })
        }),
      )
    } finally {
      isResumingPersistedRuns.value = false
    }
  }

  const retryConversationRecovery = async (conversationId = currentConversationId.value) => {
    if (!conversationId) return

    const persistedRun = persistedRuns.value[conversationId]
    if (!persistedRun) return
    if (getRunState(conversationId).status === 'running') return

    if (!providerConfigured.value) {
      openSettings()
      return
    }

    const now = new Date().toISOString()
    await savePersistedRun({
      ...persistedRun,
      status: 'running',
      updatedAt: now,
      lastError: '',
    })

    updateConversationRunState(conversationId, (state) => ({
      ...state,
      requestId: persistedRun.requestId,
      status: 'running',
      stage: persistedRun.stage || 'stage1',
      startedAt: persistedRun.startedAt,
      completedAt: null,
      lastActivityAt: now,
      lastError: '',
      hasUnreadUpdate: false,
      isRecovering: true,
    }))

    await resumePersistedRuns([conversationId], { includeErrored: true })
  }

  const stopConversation = (conversationId = currentConversationId.value) => {
    if (!conversationId) return
    const state = getRunState(conversationId)
    if (state.status !== 'running' || !state.requestId) return
    markConversationStoppedState(conversationId, state.requestId)
    activeRunControllers.get(conversationId)?.controller.abort()
  }

  const rerunConversation = async (input: UserInputPayload, conversationId = currentConversationId.value) => {
    const nextInput = normalizeUserInputPayload(input)
    if (!hasUserInputContent(nextInput) || !conversationId) return

    if (!providerConfigured.value) {
      lastProviderError.value = t('errorConfigureProviderBeforeSend')
      openSettings()
      return
    }

    const currentRunState = conversationRunStates.value[conversationId]
    if (currentRunState?.status === 'running') {
      lastProviderError.value = t('errorConversationAlreadyRunning')
      return
    }

    let conversation: Conversation | null = conversationCache.value[conversationId] || null
    if (!conversation) {
      conversation = await loadConversation(conversationId, { force: true })
    }
    if (!conversation) return

    const latestUserMessageIndex = getLatestUserMessageIndex(conversation)
    if (latestUserMessageIndex < 0) return

    const latestUserMessage = conversation.messages[latestUserMessageIndex]
    if (!latestUserMessage || latestUserMessage.role !== 'user') return

    const latestAssistantMessageIndex = getLatestAssistantMessageIndex(conversation)
    const latestAssistantMessage =
      latestAssistantMessageIndex >= 0
        ? (conversation.messages[latestAssistantMessageIndex] as AssistantConversationMessage | undefined)
        : undefined
    const runConfig = resolveStoredRunConfig(latestAssistantMessage?.runConfig, currentRunConfig.value)
    if (runConfig.councilModels.length === 0) {
      lastProviderError.value = t('errorSelectCouncilModels')
      return
    }

    const validationMessage = getRunAttachmentValidationMessage(nextInput, runConfig)
    if (validationMessage) {
      lastProviderError.value = validationMessage
      return
    }

    lastProviderError.value = ''

    const assistantMessage = createRunningAssistantPlaceholder(runConfig)
    const shouldGenerateTitle = !hasResolvedConversationTitle(conversation)

    const nextConversation = updateConversationById(conversationId, (currentConversationValue) => {
      const baselineConversation = currentConversationValue || cloneValue(conversation)
      const nextMessages = baselineConversation.messages.slice(0, latestUserMessageIndex + 1)

      nextMessages[latestUserMessageIndex] = {
        ...nextMessages[latestUserMessageIndex],
        role: 'user',
        input: cloneUserInputPayload(nextInput),
      }

      nextMessages.push(assistantMessage)

      return {
        ...baselineConversation,
        messages: nextMessages,
      }
    })

    if (!nextConversation) return

    try {
      await api.saveConversation(nextConversation)
    } catch (error) {
      console.error('Failed to persist rerun conversation', error)
      await loadConversation(conversationId, { force: true })
      return
    }

    upsertConversationInSidebar({
      id: nextConversation.id,
      project_id: nextConversation.project_id,
      created_at: nextConversation.created_at,
      title: nextConversation.title,
      message_count: nextConversation.messages.length,
    })

    await launchConversationRun({
      conversationId: nextConversation.id,
      projectId: nextConversation.project_id,
      assistantMessageId: assistantMessage.id,
      assistantMessageCreatedAt: assistantMessage.created_at,
      userMessageId: latestUserMessage.id || createRequestId(),
      input: nextInput,
      runConfig,
      shouldGenerateTitle,
      messageLocale: locale.value,
    })
  }

  const sendMessage = async (input: UserInputPayload) => {
    const nextInput = normalizeUserInputPayload(input)
    if (!hasUserInputContent(nextInput)) return

    if (!providerConfigured.value) {
      lastProviderError.value = t('errorConfigureProviderBeforeSend')
      openSettings()
      return
    }

    let conversationForRequest: Conversation
    const shouldActivateConversationAfterOptimisticSave = !currentConversationId.value

    try {
      conversationForRequest = await ensureConversationForSend({
        activate: !shouldActivateConversationAfterOptimisticSave,
      })
    } catch (error) {
      console.error('Failed to create conversation', error)
      return
    }

    const conversationIdForRequest = conversationForRequest.id
    const activeProjectId = conversationForRequest.project_id
    const currentRunState = conversationRunStates.value[conversationIdForRequest]
    const existingMessageCount = Array.isArray(conversationForRequest.messages)
      ? conversationForRequest.messages.length
      : conversationCache.value[conversationIdForRequest]?.messages.length || 0

    if (currentRunState?.status === 'running') {
      lastProviderError.value = t('errorConversationAlreadyRunning')
      return
    }

    if (existingMessageCount > 0) {
      return
    }

    const runConfig = currentRunConfig.value
    if (runConfig.councilModels.length === 0) {
      lastProviderError.value = t('errorSelectCouncilModels')
      return
    }

    const validationMessage = getRunAttachmentValidationMessage(nextInput, runConfig)
    if (validationMessage) {
      lastProviderError.value = validationMessage
      return
    }

    lastProviderError.value = ''

    const assistantMessage = createRunningAssistantPlaceholder(runConfig)
    const userMessage = createUserMessage(nextInput)
    const optimisticCreatedAt = conversationForRequest.created_at || new Date().toISOString()
    const optimisticTitle = String(conversationForRequest.title || t('conversationUntitled')).trim()
    const shouldGenerateTitle = existingMessageCount === 0 || !hasResolvedConversationTitle(conversationForRequest)

    const nextConversation = updateConversationById(conversationIdForRequest, (conversation) => {
      const baselineConversation =
        conversation ||
        createConversationSnapshot({
          id: conversationIdForRequest,
          projectId: activeProjectId,
          createdAt: optimisticCreatedAt,
          title: optimisticTitle || t('conversationUntitled'),
        })

      return {
        ...baselineConversation,
        title:
          String(baselineConversation.title || optimisticTitle || t('conversationUntitled')).trim() ||
          t('conversationUntitled'),
        messages: [...baselineConversation.messages, userMessage, assistantMessage],
      }
    })

    if (!nextConversation) {
      return
    }

    try {
      await api.saveConversation(nextConversation)
    } catch (error) {
      console.error('Failed to persist optimistic conversation', error)
      await loadConversation(conversationIdForRequest, { force: true })
      return
    }

    upsertConversationInSidebar({
      id: conversationIdForRequest,
      project_id: activeProjectId,
      created_at: optimisticCreatedAt,
      title: optimisticTitle || t('conversationUntitled'),
      message_count: existingMessageCount + 2,
    })

    if (shouldActivateConversationAfterOptimisticSave) {
      currentConversationId.value = conversationIdForRequest
      await loadProjects()
    }

    await launchConversationRun({
      conversationId: conversationIdForRequest,
      projectId: activeProjectId,
      assistantMessageId: assistantMessage.id,
      assistantMessageCreatedAt: assistantMessage.created_at,
      userMessageId: userMessage.id || createRequestId(),
      input: nextInput,
      runConfig,
      shouldGenerateTitle,
      messageLocale: locale.value,
    })
  }

  watch(currentConversationId, async (conversationId) => {
    if (hasLoadedAppPreferences.value) {
      void saveAppPreferences({ lastConversationId: conversationId || null })
    }
    if (!conversationId) return
    clearConversationUnread(conversationId)
    if (!conversationCache.value[conversationId] || conversationRunStates.value[conversationId]?.status !== 'running') {
      await loadConversation(conversationId, { force: true })
    }
  })

  watch(currentProjectId, async (projectId) => {
    const nextConversations = await loadConversations(projectId)

    if (!hasRestoredSelection.value) {
      hasRestoredSelection.value = true
      if (preferredConversationId.value && nextConversations.some((conversation) => conversation.id === preferredConversationId.value)) {
        currentConversationId.value = preferredConversationId.value
      } else if (!currentConversationId.value || !nextConversations.some((conversation) => conversation.id === currentConversationId.value)) {
        currentConversationId.value = null
      }
    }

    if (hasLoadedAppPreferences.value) {
      void saveAppPreferences({
        lastProjectId: projectId || null,
        ...(projectId ? {} : { lastConversationId: null }),
      })
    }
  })

  watch(
    currentChatRunPreferences,
    (nextPreferences) => {
      const currentSelection = chatRunPreferences.value.selectedCouncilModels.join('|')
      const nextSelection = nextPreferences.selectedCouncilModels.join('|')
      if (
        chatRunPreferences.value.targetStage === nextPreferences.targetStage &&
        currentSelection === nextSelection
      ) {
        return
      }

      if (!hasLoadedAppPreferences.value) {
        chatRunPreferences.value = nextPreferences
        return
      }

      void persistChatRunPreferences(nextPreferences)
    },
    { deep: true },
  )

  watch(providerConfigured, (configured) => {
    if (configured) {
      void resumePersistedRuns()
    }
  })

  onMounted(async () => {
    await loadAppPreferences()
    await Promise.all([loadProjects(), loadProviderSettings()])
    await hydratePersistedRuns()
    await resumePersistedRuns()
  })

  return {
    conversations,
    conversationRunStates,
    currentConversation,
    currentConversationCanRetryRecovery,
    currentConversationId,
    currentConversationRecoveryError,
    currentConversationRecovering,
    currentConversationRunState,
    currentConversationRunning,
    currentChatRunPreferences,
    currentProject,
    currentProjectId,
    draftMessage,
    groupedConversations,
    goHome,
    isLoading: hasRunningConversations,
    isRecoveringRuns: hasRecoveringConversations,
    isSettingsOpen,
    isSidebarCollapsed,
    lastProviderError,
    locale,
    projects,
    providerConfigured,
    providerSettings,
    providerStatus,
    providerStatusText,
    runtimeConfig,
    suggestedProjectName,
    settingsError,
    clearSettings,
    closeSettings,
    createProject,
    deleteConversation,
    deleteProject,
    loadConversations,
    newConversation,
    openSettings,
    renameConversation,
    renameProject,
    resetChatRunPreferences,
    retryConversationRecovery,
    rerunConversation,
    saveSettings,
    selectConversation,
    selectAllChatCouncilModels,
    selectProject,
    sendMessage,
    setLocale: setAppLocale,
    setChatTargetStage,
    stopConversation,
    toggleChatCouncilModel,
    toggleSidebar: () => {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    },
    t,
  }
}
