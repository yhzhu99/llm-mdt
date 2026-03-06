import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { api } from '@/api'
import { useI18n } from '@/i18n'
import type {
  AssistantConversationMessage,
  AssistantLoadingState,
  AssistantStreamMeta,
  AssistantStreamState,
  Conversation,
  ConversationRunState,
  ConversationSummary,
  PersistedConversationRun,
  ProjectSummary,
  ProviderSettings,
  ProviderSettingsInput,
  RuntimeConfig,
  Stage1StreamState,
  Stage2StreamState,
  Stage3StreamState,
  StreamStatusMeta,
} from '@/types'
import { getProviderStatusText, groupConversationsByDate, toRuntimeConfig } from '@/utils/conversations'

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

const createUserMessage = (content: string) => ({
  id:
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  role: 'user' as const,
  content,
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

const createFreshAssistantMessage = (assistantId: string, councilOrder: string[], createdAt?: string) => ({
  ...createAssistantMessage(councilOrder),
  id: assistantId,
  created_at: createdAt || new Date().toISOString(),
})

const markStatusMapAsError = (statuses: Record<string, StreamStatusMeta>, message: string) =>
  Object.fromEntries(
    Object.entries(statuses).map(([model, meta]) => [
      model,
      meta.status === 'complete' ? meta : { status: 'error' as const, message },
    ]),
  ) as Record<string, StreamStatusMeta>

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

const getRunTimestamp = (state: ConversationRunState) =>
  new Date(state.lastActivityAt || state.completedAt || state.startedAt || 0).getTime()

export function useMdtApp() {
  const { locale, setLocale, t } = useI18n()
  const conversations = ref<ConversationSummary[]>([])
  const conversationCache = ref<Record<string, Conversation>>({})
  const conversationRunStates = ref<Record<string, ConversationRunState>>({})
  const persistedRuns = ref<Record<string, PersistedConversationRun>>({})
  const projects = ref<ProjectSummary[]>([])
  const currentConversationId = ref<string | null>(null)
  const currentProjectId = ref<string | null>(null)
  const draftMessage = ref('')
  const providerSettings = ref<ProviderSettings | null>(null)
  const isSettingsOpen = ref(false)
  const settingsError = ref('')
  const lastProviderError = ref('')
  const isSidebarCollapsed = ref(false)
  const hasHydratedPersistedRuns = ref(false)
  const isResumingPersistedRuns = ref(false)
  const resumingRunIds = new Set<string>()

  const currentProject = computed(
    () => projects.value.find((project) => project.id === currentProjectId.value) || null,
  )
  const currentConversation = computed(() =>
    currentConversationId.value ? conversationCache.value[currentConversationId.value] || null : null,
  )
  const currentConversationRunState = computed(() =>
    currentConversationId.value
      ? conversationRunStates.value[currentConversationId.value] || createIdleRunState()
      : createIdleRunState(),
  )
  const currentConversationRunning = computed(() => currentConversationRunState.value.status === 'running')
  const hasRunningConversations = computed(() =>
    Object.values(conversationRunStates.value).some((state) => state.status === 'running'),
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
  const groupedConversations = computed(() => groupConversationsByDate(conversations.value, locale.value))
  const providerConfigured = computed(() => runtimeConfig.value.configured)
  const providerStatus = computed<'ready' | 'running' | 'error' | 'unconfigured'>(() => {
    if (hasRunningConversations.value) return 'running'
    if (providerErrorMessage.value) return 'error'
    if (providerConfigured.value) return 'ready'
    return 'unconfigured'
  })
  const providerStatusText = computed(() =>
    getProviderStatusText(providerStatus.value, providerSettings.value, providerErrorMessage.value, locale.value),
  )

  const hasResolvedConversationTitle = (conversation?: Pick<Conversation, 'title'> | null) => {
    const trimmed = String(conversation?.title || '').trim()
    return Boolean(trimmed) && !placeholderConversationTitles.has(trimmed)
  }

  const isActiveRequest = (conversationId: string, requestId: string) =>
    conversationRunStates.value[conversationId]?.requestId === requestId

  const getConversationSummary = (conversationId: string) =>
    conversations.value.find((entry) => entry.id === conversationId) || null

  const getRunState = (conversationId: string) => conversationRunStates.value[conversationId] || createIdleRunState()

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
      updatedAt: new Date().toISOString(),
    }
    cachePersistedRun(next)
    void api.saveConversationRun(next)
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
    } catch (error) {
      console.error('Failed to load app preferences', error)
    }
  }

  const setAppLocale = async (nextLocale: 'zh-CN' | 'en') => {
    const saved = await api.saveAppPreferences(nextLocale)
    setLocale(saved.locale)
  }

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
    draftMessage.value = ''
  }

  const newConversation = () => {
    resetDraftState()
  }

  const removeProjectArtifacts = async (projectId: string) => {
    const nextCache = { ...conversationCache.value }
    const nextRunStates = { ...conversationRunStates.value }

    for (const [conversationId, conversation] of Object.entries(conversationCache.value)) {
      if (conversation.project_id === projectId) {
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
      resetDraftState()
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
        resetDraftState()
      }

      await loadConversations(currentProjectId.value)
    } catch (error) {
      console.error('Failed to delete project', error)
    }
  }

  const deleteConversation = async (conversationId: string) => {
    try {
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
    resetDraftState()
  }

  const ensureConversationForSend = async () => {
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
    currentConversationId.value = conversation.id
    upsertConversationInSidebar({
      id: conversation.id,
      project_id: conversation.project_id,
      created_at: conversation.created_at,
      title: conversation.title,
      message_count: conversation.messages.length,
    })
    await loadProjects()
    return cloneValue(conversation)
  }

  const buildPersistedRun = ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    userMessageId,
    content,
    shouldGenerateTitle,
    startedAt,
  }: {
    conversationId: string
    projectId: string
    requestId: string
    assistantMessageId: string
    userMessageId: string
    content: string
    shouldGenerateTitle: boolean
    startedAt: string
  }): PersistedConversationRun => ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    userMessageId,
    content,
    locale: locale.value,
    shouldGenerateTitle,
    startedAt,
    updatedAt: startedAt,
    stage: 'stage1',
    status: 'running',
  })

  const rehydrateRunState = (run: PersistedConversationRun) => {
    const current = getRunState(run.conversationId)
    updateConversationRunState(run.conversationId, () => ({
      requestId: run.requestId,
      status: run.status === 'complete' ? 'complete' : run.status === 'error' ? 'error' : 'running',
      stage: run.stage,
      startedAt: run.startedAt,
      completedAt: run.status === 'running' ? null : run.updatedAt,
      lastActivityAt: run.updatedAt,
      lastError: current.lastError,
      hasUnreadUpdate: currentConversationId.value === run.conversationId ? false : true,
    }))
  }

  const prepareAssistantPlaceholder = async ({
    conversationId,
    assistantMessageId,
    assistantCreatedAt,
  }: {
    conversationId: string
    assistantMessageId: string
    assistantCreatedAt?: string
  }) => {
    const nextConversation = updateConversationById(conversationId, (conversation) => {
      if (!conversation) return conversation
      const placeholderIndex = conversation.messages.findIndex(
        (message) => message.role === 'assistant' && message.id === assistantMessageId,
      )
      const freshAssistant = createFreshAssistantMessage(
        assistantMessageId,
        runtimeConfig.value.council_models,
        assistantCreatedAt,
      )

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
          updateConversationRunState(conversationId, (current) => ({
            ...current,
            status: 'error',
            completedAt: now,
            lastActivityAt: now,
            lastError: current.lastError || t('orchestratorRunFailed'),
            hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
          }))
        }
      }

      if (persistedRuns.value[conversationId]) {
        await deletePersistedRun(conversationId).catch((error) => {
          console.error('Failed to clear persisted run', error)
        })
      }
    }
  }

  const runConversationTask = async ({
    conversationId,
    projectId,
    requestId,
    assistantMessageId,
    assistantMessageCreatedAt,
    content,
    shouldGenerateTitle,
    messageLocale,
  }: {
    conversationId: string
    projectId: string
    requestId: string
    assistantMessageId: string
    assistantMessageCreatedAt?: string
    content: string
    shouldGenerateTitle: boolean
    messageLocale: 'zh-CN' | 'en'
  }) => {
    const updateAssistantMessage = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
      if (!isActiveRequest(conversationId, requestId)) return
      updateAssistantMessageInConversation(conversationId, assistantMessageId, recipe)
    }

    const setAssistantErrorState = (errorMessage: string) => {
      const nextErrorMessage = String(errorMessage || t('orchestratorRunFailed')).trim() || t('orchestratorRunFailed')

      updateAssistantMessage((message) => ({
        ...message,
        stage3: message.stage3 || {
          model: runtimeConfig.value.chairman_model || 'chairman',
          response: message.stream.stage3.response || nextErrorMessage,
          reasoning_details: null,
        },
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
          stage3: { status: 'error', message: nextErrorMessage },
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
    const enqueueAssistantUpdate = (recipe: (message: LiveAssistantMessage) => LiveAssistantMessage) => {
      queue.push(recipe)
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(() => {
        scheduled = false
        if (!isActiveRequest(conversationId, requestId)) return
        const jobs = queue.splice(0, queue.length)
        if (jobs.length === 0) return
        updateAssistantMessage((message) => jobs.reduce((current, job) => job(current), message))
      })
    }

    try {
      await api.sendMessageStream(
        conversationId,
        { content, locale: messageLocale },
        async (_eventType, event) => {
          if (!isActiveRequest(conversationId, requestId)) return

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
                stage: 'stage3',
                completedAt: now,
                lastActivityAt: now,
                hasUnreadUpdate: currentConversationId.value === conversationId ? false : true,
              }))
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
              }))
              break
            }
          }
        },
        {
          persistUserMessage: false,
          shouldGenerateTitle,
          assistantMessageId,
          assistantMessageCreatedAt,
        },
      )
    } catch (error) {
      if (!isActiveRequest(conversationId, requestId)) return
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
      }))
    } finally {
      await syncConversationAfterRun(conversationId, projectId, requestId)
    }
  }

  const resumePersistedRuns = async () => {
    if (!hasHydratedPersistedRuns.value || !providerConfigured.value || isResumingPersistedRuns.value) {
      return
    }

    const recoverableRuns = Object.values(persistedRuns.value).filter((run) => run.status === 'running')
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

          await prepareAssistantPlaceholder({
            conversationId: run.conversationId,
            assistantMessageId: run.assistantMessageId,
            assistantCreatedAt:
              (conversation.messages.find(
                (message) => message.role === 'assistant' && message.id === run.assistantMessageId,
              ) as AssistantConversationMessage | undefined)?.created_at || run.startedAt,
          })

          const shouldGenerateTitle = run.shouldGenerateTitle && !hasResolvedConversationTitle(conversation)
          rehydrateRunState(run)

          void runConversationTask({
            conversationId: run.conversationId,
            projectId: run.projectId,
            requestId: run.requestId,
            assistantMessageId: run.assistantMessageId,
            assistantMessageCreatedAt:
              (conversation.messages.find(
                (message) => message.role === 'assistant' && message.id === run.assistantMessageId,
              ) as AssistantConversationMessage | undefined)?.created_at || run.startedAt,
            content: run.content,
            shouldGenerateTitle,
            messageLocale: run.locale,
          })
        }),
      )
    } finally {
      isResumingPersistedRuns.value = false
    }
  }

  const sendMessage = async (content: string) => {
    const trimmedContent = String(content || '').trim()
    if (!trimmedContent) return

    if (!providerConfigured.value) {
      lastProviderError.value = t('errorConfigureProviderBeforeSend')
      openSettings()
      return
    }

    let conversationForRequest: Conversation

    try {
      conversationForRequest = await ensureConversationForSend()
    } catch (error) {
      console.error('Failed to create conversation', error)
      return
    }

    const conversationIdForRequest = conversationForRequest.id
    const activeProjectId = conversationForRequest.project_id
    const currentRunState = conversationRunStates.value[conversationIdForRequest]

    if (currentRunState?.status === 'running') {
      lastProviderError.value = t('errorConversationAlreadyRunning')
      return
    }

    lastProviderError.value = ''

    const requestId = createRequestId()
    const assistantMessage = {
      ...createAssistantMessage(runtimeConfig.value.council_models),
      id: requestId,
    }
    const userMessage = createUserMessage(trimmedContent)
    const optimisticCreatedAt = conversationForRequest.created_at || new Date().toISOString()
    const optimisticTitle = String(conversationForRequest.title || t('conversationUntitled')).trim()
    const existingMessageCount = Array.isArray(conversationForRequest.messages)
      ? conversationForRequest.messages.length
      : conversationCache.value[conversationIdForRequest]?.messages.length || 0
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

    const startedAt = new Date().toISOString()
    const persistedRun = buildPersistedRun({
      conversationId: conversationIdForRequest,
      projectId: activeProjectId,
      requestId,
      assistantMessageId: assistantMessage.id,
      userMessageId: userMessage.id || requestId,
      content: trimmedContent,
      shouldGenerateTitle,
      startedAt,
    })

    try {
      await savePersistedRun(persistedRun)
    } catch (error) {
      console.error('Failed to save persisted run', error)
      return
    }

    conversationRunStates.value[conversationIdForRequest] = {
      requestId,
      status: 'running',
      stage: 'stage1',
      startedAt,
      completedAt: null,
      lastActivityAt: startedAt,
      lastError: '',
      hasUnreadUpdate: false,
    }

    void runConversationTask({
      conversationId: conversationIdForRequest,
      projectId: activeProjectId,
      requestId,
      assistantMessageId: assistantMessage.id,
      assistantMessageCreatedAt: assistantMessage.created_at,
      content: trimmedContent,
      shouldGenerateTitle,
      messageLocale: locale.value,
    })
  }

  watch(currentConversationId, async (conversationId) => {
    if (!conversationId) return
    clearConversationUnread(conversationId)
    if (!conversationCache.value[conversationId] || conversationRunStates.value[conversationId]?.status !== 'running') {
      await loadConversation(conversationId, { force: true })
    }
  })

  watch(currentProjectId, async (projectId) => {
    await loadConversations(projectId)
  })

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
    currentConversationId,
    currentConversationRunState,
    currentConversationRunning,
    currentProject,
    currentProjectId,
    draftMessage,
    groupedConversations,
    isLoading: hasRunningConversations,
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
    saveSettings,
    selectConversation,
    selectProject,
    sendMessage,
    setLocale: setAppLocale,
    toggleSidebar: () => {
      isSidebarCollapsed.value = !isSidebarCollapsed.value
    },
    t,
  }
}
