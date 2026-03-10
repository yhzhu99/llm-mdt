<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Crown, LoaderCircle, MessageSquareText, Pencil, Scale, Settings2, Sparkles, Square } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { cn } from '@/utils'
import Button from '@/components/ui/button/Button.vue'
import ChatComposer from './ChatComposer.vue'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageNavigation from './StageNavigation.vue'
import StageOneCard from './StageOneCard.vue'
import StageThreeCard from './StageThreeCard.vue'
import StageTwoCard from './StageTwoCard.vue'
import TraceLog from './TraceLog.vue'

interface ConversationMessageBase {
  id?: string
  role: 'user' | 'assistant'
}

interface UserMessage extends ConversationMessageBase {
  role: 'user'
  content: string
}

interface StageOneResponse {
  model: string
  response: string
  reasoning_details?: string | null
}

interface StageTwoRanking {
  model: string
  ranking: string
  reasoning_details?: string | null
  parsed_ranking?: string[]
}

interface AggregateRanking {
  model: string
  average_rank: number
  rankings_count: number
}

interface StageThreeResult {
  model: string
  response: string
  reasoning_details?: string | null
  diagnostics?: {
    configured_mode: 'auto' | 'responses' | 'chat-completions'
    selected_mode: 'responses' | 'chat-completions' | null
    endpoint: string
    fallback_used: boolean
    attempts: Array<{ mode: 'responses' | 'chat-completions'; endpoint: string; status: 'succeeded' | 'failed'; error?: string }>
    stream_event_types: string[]
    reasoning_event_count: number
    content_event_count: number
    reasoning_text_chars: number
    content_text_chars: number
    saw_reasoning: boolean
    reasoning_details_present: boolean
  } | null
}

interface AssistantMessage extends ConversationMessageBase {
  role: 'assistant'
  stage1?: StageOneResponse[] | null
  stage2?: StageTwoRanking[] | null
  stage3?: StageThreeResult | null
  metadata?: {
    label_to_model?: Record<string, string>
    aggregate_rankings?: AggregateRanking[]
  } | null
  stream?: {
    stage1?: Record<string, { response: string; thinking: string }>
    stage2?: Record<string, { ranking: string; thinking: string }>
    stage3?: { response: string; thinking: string }
  }
  streamMeta?: {
    stage1?: Record<string, { status: 'idle' | 'running' | 'complete' | 'error'; message?: string }>
    stage2?: Record<string, { status: 'idle' | 'running' | 'complete' | 'error'; message?: string }>
    stage3?: { status: 'idle' | 'running' | 'complete' | 'error'; message?: string }
  }
  loading?: {
    stage1?: boolean
    stage2?: boolean
    stage3?: boolean
  }
  runConfig?: {
    targetStage: StageKey
    councilModels: string[]
    chairmanModel: string
  } | null
}

interface ConversationDetail {
  id: string
  title: string
  messages: Array<UserMessage | AssistantMessage>
}

interface RuntimeConfigLike {
  council_models?: string[]
  chairman_model?: string
}

type StageKey = 'stage1' | 'stage2' | 'stage3'
type StageStatus = 'waiting' | 'running' | 'complete' | 'error'
type RunStatus = 'idle' | 'running' | 'complete' | 'error' | 'stopped'
type AssistantStatus = StageStatus | 'stopped'

const props = withDefaults(
  defineProps<{
    conversation?: ConversationDetail | null
    draft?: string
    chatRunPreferences?: {
      targetStage: StageKey
      selectedCouncilModels: string[]
    }
    canRetryRecovery?: boolean
    isLoading?: boolean
    isRecovering?: boolean
    recoveryError?: string
    runStatus?: RunStatus
    runtimeConfig?: RuntimeConfigLike | null
    providerConfigured?: boolean
  }>(),
  {
    conversation: null,
    draft: '',
    chatRunPreferences: () => ({
      targetStage: 'stage3' as const,
      selectedCouncilModels: [] as string[],
    }),
    canRetryRecovery: false,
    isLoading: false,
    isRecovering: false,
    recoveryError: '',
    runStatus: 'idle',
    runtimeConfig: null,
    providerConfigured: false,
  },
)

const emit = defineEmits<{
  (event: 'update:draft', value: string): void
  (event: 'update-target-stage', value: StageKey): void
  (event: 'toggle-model', model: string): void
  (event: 'select-all-models'): void
  (event: 'reset-run-config'): void
  (event: 'send', value: string): void
  (event: 'new-conversation'): void
  (event: 'open-settings'): void
  (event: 'rerun', value: string): void
  (event: 'retry-recovery'): void
  (event: 'stop'): void
}>()

const { t } = useI18n()
const scrollRootRef = ref<HTMLElement | null>(null)
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
const isEditingLatestPrompt = ref(false)
const editingPrompt = ref('')

const draftValue = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value),
})

const stageRank: Record<StageKey, number> = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
}

const composerAvailableModels = computed(() => props.runtimeConfig?.council_models || [])
const hasConversationMessages = computed(() => Boolean(props.conversation?.messages?.length))

const shortModelName = (model: string) => model.split('/')[1] || model
const messageTargetStage = (message: AssistantMessage): StageKey => message.runConfig?.targetStage || 'stage3'
const messageCouncilOrder = (message: AssistantMessage) =>
  message.runConfig?.councilModels?.length ? message.runConfig.councilModels : props.runtimeConfig?.council_models || []
const messageChairmanModel = (message: AssistantMessage) =>
  message.runConfig?.chairmanModel || props.runtimeConfig?.chairman_model || 'chairman'
const stageEnabledForMessage = (message: AssistantMessage, stage: StageKey) =>
  stageRank[stage] <= stageRank[messageTargetStage(message)]
const visibleStagesForMessage = (message: AssistantMessage) =>
  (['stage1', 'stage2', 'stage3'] as StageKey[]).filter((stage) => stageEnabledForMessage(message, stage))

const latestAssistantFingerprint = computed(() => {
  const messages = props.conversation?.messages || []
  const latestAssistant = [...messages].reverse().find(
    (message): message is AssistantMessage => message.role === 'assistant',
  )

  if (!latestAssistant) return ''

  const stage1 = Object.entries(latestAssistant.stream?.stage1 || {})
    .map(
      ([model, state]) =>
        `${model}:${state.response.length}:${state.thinking.length}:${latestAssistant.streamMeta?.stage1?.[model]?.status || 'idle'}`,
    )
    .join('|')
  const stage2 = Object.entries(latestAssistant.stream?.stage2 || {})
    .map(
      ([model, state]) =>
        `${model}:${state.ranking.length}:${state.thinking.length}:${latestAssistant.streamMeta?.stage2?.[model]?.status || 'idle'}`,
    )
    .join('|')
  const stage3 = [
    latestAssistant.stream?.stage3?.response.length || 0,
    latestAssistant.stream?.stage3?.thinking.length || 0,
    latestAssistant.streamMeta?.stage3?.status || 'idle',
  ].join(':')

  return [
    latestAssistant.id,
    latestAssistant.runConfig?.targetStage || 'stage3',
    (latestAssistant.runConfig?.councilModels || []).join('|'),
    latestAssistant.stage1?.length || 0,
    latestAssistant.stage2?.length || 0,
    latestAssistant.stage3?.response.length || 0,
    stage1,
    stage2,
    stage3,
  ].join('::')
})

const latestAssistantEntry = computed(() => {
  const messages = props.conversation?.messages || []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') {
      return {
        index,
        message: message as AssistantMessage,
      }
    }
  }

  return null
})

const latestUserEntry = computed(() => {
  const messages = props.conversation?.messages || []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') {
      return {
        index,
        message: message as UserMessage,
      }
    }
  }

  return null
})

const handleSend = (value: string) => emit('send', value)
const handleTargetStageChange = (value: StageKey) => emit('update-target-stage', value)
const handleToggleModel = (model: string) => emit('toggle-model', model)
const handleSelectAllModels = () => emit('select-all-models')
const handleResetRunConfig = () => emit('reset-run-config')
const autosizeEditTextarea = () => {
  const textarea = editTextareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 360)}px`
}

const startEditingLatestPrompt = async () => {
  if (props.isLoading || !latestUserEntry.value) return
  isEditingLatestPrompt.value = true
  editingPrompt.value = latestUserEntry.value.message.content
  await nextTick()
  editTextareaRef.value?.focus()
  editTextareaRef.value?.setSelectionRange(editingPrompt.value.length, editingPrompt.value.length)
  autosizeEditTextarea()
}

const cancelEditingLatestPrompt = () => {
  isEditingLatestPrompt.value = false
  editingPrompt.value = ''
}

const handleRerun = () => {
  const value = editingPrompt.value.trim()
  if (!value || props.isLoading) return
  emit('rerun', value)
  cancelEditingLatestPrompt()
}

const handleEditKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    handleRerun()
  }
}

const isLatestUserMessage = (index: number) => latestUserEntry.value?.index === index
const isLatestAssistantMessage = (index: number) => latestAssistantEntry.value?.index === index
const stageSectionId = (messageId: string | undefined, stage: StageKey) => `${messageId || 'assistant'}-${stage}`
const tracePayloadForMessage = (message: AssistantMessage) => {
  const payload: Record<string, unknown> = {}

  if (message.metadata) {
    payload.ranking = message.metadata
  }

  if (message.runConfig) {
    payload.run_config = {
      target_stage: message.runConfig.targetStage,
      council_models: message.runConfig.councilModels,
      chairman_model: message.runConfig.chairmanModel,
    }
  }

  if (message.stage3?.diagnostics || message.stage3 || message.streamMeta?.stage3?.status === 'error') {
    payload.stage3 = {
      model: message.stage3?.model || messageChairmanModel(message),
      reasoning_available: Boolean(message.stage3?.reasoning_details || message.stream?.stage3?.thinking),
      diagnostics: message.stage3?.diagnostics || null,
      stream_status: message.streamMeta?.stage3?.status || 'idle',
      stream_error: message.streamMeta?.stage3?.message || '',
    }
  }

  return Object.keys(payload).length > 0 ? payload : null
}

const stageTitle = (stage: StageKey) => {
  if (stage === 'stage1') return t('stage1Title')
  if (stage === 'stage2') return t('stage2Title')
  return t('stage3Title')
}

const stageStatusFromModelMeta = (
  meta: Record<string, { status: 'idle' | 'running' | 'complete' | 'error'; message?: string }> | undefined,
  loading: boolean,
  hasCompleteContent: boolean,
): StageStatus => {
  const statuses = Object.values(meta || {})

  if (loading || statuses.some((entry) => entry.status === 'running')) {
    return 'running'
  }

  if (hasCompleteContent) {
    return 'complete'
  }

  if (statuses.some((entry) => entry.status === 'error')) {
    return 'error'
  }

  return 'waiting'
}

const hasStageSection = (message: AssistantMessage, stage: StageKey) => {
  if (!stageEnabledForMessage(message, stage)) return false

  if (stage === 'stage1') {
    return Boolean(message.loading?.stage1 || message.stage1?.length || Object.keys(message.stream?.stage1 || {}).length)
  }

  if (stage === 'stage2') {
    return Boolean(message.loading?.stage2 || message.stage2?.length || Object.keys(message.stream?.stage2 || {}).length)
  }

  return Boolean(
    message.loading?.stage3 ||
      message.stage3 ||
      message.stream?.stage3?.response ||
      message.stream?.stage3?.thinking ||
      message.streamMeta?.stage3?.status === 'error',
  )
}

const shouldRenderStageSection = (message: AssistantMessage, index: number, stage: StageKey) =>
  stageEnabledForMessage(message, stage) && (hasStageSection(message, stage) || isAssistantActiveTurn(index))

const baseStageStatuses = (message: AssistantMessage): Record<StageKey, StageStatus> => ({
  stage1: stageStatusFromModelMeta(
    message.streamMeta?.stage1,
    Boolean(message.loading?.stage1),
    Boolean(message.stage1?.length),
  ),
  stage2: stageStatusFromModelMeta(
    message.streamMeta?.stage2,
    Boolean(message.loading?.stage2),
    Boolean(message.stage2?.length),
  ),
  stage3:
    message.loading?.stage3 || message.streamMeta?.stage3?.status === 'running'
      ? 'running'
      : message.stage3 || message.streamMeta?.stage3?.status === 'complete'
        ? 'complete'
        : message.streamMeta?.stage3?.status === 'error'
          ? 'error'
          : 'waiting',
})

const isAssistantActiveTurn = (index: number) =>
  Boolean(props.isLoading) && Boolean(props.conversation) && index === props.conversation!.messages.length - 1

const stageStatuses = (message: AssistantMessage, index: number): Record<StageKey, StageStatus> => {
  const statuses = baseStageStatuses(message)
  if (
    isAssistantActiveTurn(index) &&
    statuses.stage1 === 'waiting' &&
    statuses.stage2 === 'waiting' &&
    statuses.stage3 === 'waiting'
  ) {
    return { ...statuses, stage1: 'running' }
  }

  return statuses
}

const stageAvailability = (message: AssistantMessage, index: number) => ({
  stage1: shouldRenderStageSection(message, index, 'stage1'),
  stage2: shouldRenderStageSection(message, index, 'stage2'),
  stage3: shouldRenderStageSection(message, index, 'stage3'),
})

const isAssistantStreaming = (message: AssistantMessage, index: number) => {
  if (isAssistantActiveTurn(index)) return true
  return Boolean(message.loading?.stage1 || message.loading?.stage2 || message.loading?.stage3)
}

const assistantCurrentStage = (message: AssistantMessage, index: number): StageKey => {
  const statuses = stageStatuses(message, index)
  const visibleStages = visibleStagesForMessage(message)

  for (const stage of [...visibleStages].reverse()) {
    if (statuses[stage] === 'running') return stage
  }

  for (const stage of [...visibleStages].reverse()) {
    if (statuses[stage] !== 'waiting') return stage
  }

  return visibleStages[0] || 'stage1'
}

const assistantOverallStatus = (message: AssistantMessage, index: number): AssistantStatus => {
  const statuses = stageStatuses(message, index)
  const visibleStages = visibleStagesForMessage(message)
  const targetStage = messageTargetStage(message)

  if (props.runStatus === 'stopped' && isLatestAssistantMessage(index)) return 'stopped'
  if (isAssistantStreaming(message, index)) return 'running'
  if (statuses[targetStage] === 'complete') return 'complete'
  if (visibleStages.some((stage) => statuses[stage] === 'error')) return 'error'
  return assistantCurrentStage(message, index) === 'stage1' && statuses.stage1 === 'waiting' ? 'waiting' : statuses[assistantCurrentStage(message, index)]
}

const assistantStatusText = (message: AssistantMessage, index: number) => {
  const status = assistantOverallStatus(message, index)
  const currentStage = assistantCurrentStage(message, index)
  const targetStage = messageTargetStage(message)

  if (status === 'running') return `${t('streaming')} · ${stageTitle(currentStage)}`
  if (status === 'complete') return `${t('stageStatusComplete')} · ${stageTitle(targetStage)}`
  if (status === 'error') return `${t('stageStatusError')} · ${stageTitle(currentStage)}`
  if (status === 'stopped') return `${t('stageStatusStopped')} · ${stageTitle(currentStage)}`
  return stageTitle(currentStage)
}

const assistantStatusBadgeClass = (status: AssistantStatus) =>
  cn(
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
    status === 'running' && 'border-primary/20 bg-primary/10 text-primary',
    status === 'complete' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    status === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
    status === 'stopped' && 'border-amber-500/20 bg-amber-500/10 text-amber-700',
    status === 'waiting' && 'border-border/70 bg-background/70 text-muted-foreground',
  )

const stageSummaryClass = (status: StageStatus) =>
  cn(
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
    status === 'running' && 'border-primary/20 bg-primary/10 text-primary',
    status === 'complete' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    status === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
    status === 'waiting' && 'border-border/70 bg-background/70 text-muted-foreground',
  )

const stageSummaryDotClass = (status: StageStatus) =>
  cn(
    'h-2.5 w-2.5 rounded-full bg-muted-foreground/35',
    status === 'running' && 'bg-primary animate-pulse',
    status === 'complete' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
  )

const currentStageIcon = (stage: StageKey) => {
  if (stage === 'stage1') return Sparkles
  if (stage === 'stage2') return Scale
  return Crown
}

const runConfigPills = (message: AssistantMessage) => [
  {
    key: 'target-stage',
    label: `${t('composerRunToStage')} · ${stageTitle(messageTargetStage(message))}`,
    title: `${t('composerRunToStage')} · ${stageTitle(messageTargetStage(message))}`,
  },
  ...messageCouncilOrder(message).map((model) => ({
    key: model,
    label: shortModelName(model),
    title: model,
  })),
]

const isNearBottom = () => {
  const root = scrollRootRef.value
  if (!root) return true
  const distance = root.scrollHeight - root.scrollTop - root.clientHeight
  return distance < 180
}

const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
  const root = scrollRootRef.value
  if (!root) return
  root.scrollTo({ top: root.scrollHeight, behavior })
}

watch(
  () => props.conversation?.messages.length ?? 0,
  async (next, previous) => {
    if (next <= previous) return
    await nextTick()
    scrollToBottom('smooth')
  },
)

watch(latestAssistantFingerprint, async () => {
  if (!props.isLoading || !isNearBottom()) return
  await nextTick()
  scrollToBottom()
})

watch(isEditingLatestPrompt, async (editing) => {
  if (!editing) return
  await nextTick()
  autosizeEditTextarea()
})

watch(editingPrompt, () => {
  if (!isEditingLatestPrompt.value) return
  nextTick(() => autosizeEditTextarea())
})

watch(
  () => latestUserEntry.value?.message.id || latestUserEntry.value?.message.content || '',
  () => {
    if (!latestUserEntry.value) {
      cancelEditingLatestPrompt()
    }
  },
)

watch(
  () => props.conversation?.id || '',
  () => {
    cancelEditingLatestPrompt()
  },
)
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),_transparent_42%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(248,250,252,0.75))]">
    <div
      ref="scrollRootRef"
      data-chat-scroll-root
      class="scrollbar-hide flex-1 overflow-y-auto px-5 py-6 sm:px-6"
    >
      <div v-if="!hasConversationMessages" class="mx-auto flex min-h-full max-w-5xl items-center justify-center">
        <div class="w-full max-w-4xl space-y-8">
          <div class="space-y-4 text-center">
            <div
              class="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary"
            >
              <MessageSquareText :size="16" />
              {{ providerConfigured ? t('browserLocalWorkflow') : t('providerSetupRequired') }}
            </div>
            <h2 class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {{ providerConfigured ? t('welcomeTitle') : t('configureBrowserProvider') }}
            </h2>
            <p class="mx-auto max-w-2xl text-base leading-7 text-muted-foreground">
              {{ providerConfigured ? t('welcomeDescription') : t('providerSetupDescription') }}
            </p>
          </div>

          <ChatComposer
            v-model="draftValue"
            centered
            :disabled="isLoading"
            :is-loading="isLoading"
            :target-stage="chatRunPreferences.targetStage"
            :selected-models="chatRunPreferences.selectedCouncilModels"
            :available-models="composerAvailableModels"
            :provider-configured="providerConfigured"
            @open-settings="emit('open-settings')"
            @send="handleSend"
            @reset-run-config="handleResetRunConfig"
            @select-all-models="handleSelectAllModels"
            @toggle-model="handleToggleModel"
            @update:target-stage="handleTargetStageChange"
          />

          <div v-if="!providerConfigured" class="flex justify-center">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              @click="emit('open-settings')"
            >
              <Settings2 :size="16" />
              {{ t('openSettings') }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-else-if="conversation"
        class="mx-auto grid w-full max-w-[92rem] gap-6 lg:grid-cols-[minmax(0,1fr)_14.5rem] lg:gap-8"
      >
        <div class="min-w-0 space-y-7">
          <div
            v-if="latestAssistantEntry"
            class="lg:hidden"
          >
            <StageNavigation
              :stage-ids="{
                stage1: stageSectionId(latestAssistantEntry.message.id, 'stage1'),
                stage2: stageSectionId(latestAssistantEntry.message.id, 'stage2'),
                stage3: stageSectionId(latestAssistantEntry.message.id, 'stage3'),
              }"
              :stage-status="stageStatuses(latestAssistantEntry.message, latestAssistantEntry.index)"
              :available-stages="stageAvailability(latestAssistantEntry.message, latestAssistantEntry.index)"
            />
          </div>

          <div
            v-if="isRecovering || canRetryRecovery"
            :class="
              cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm',
                isRecovering
                  ? 'border-primary/20 bg-primary/5 text-primary'
                  : 'border-destructive/20 bg-destructive/5 text-destructive',
              )
            "
          >
            <div class="flex min-w-0 items-center gap-3">
              <LoaderCircle v-if="isRecovering" :size="16" class="animate-spin" />
              <MessageSquareText v-else :size="16" />
              <div class="min-w-0">
                <div>{{ isRecovering ? t('conversationRecoveryBanner') : t('conversationRecoveryFailed') }}</div>
                <div v-if="recoveryError" class="truncate text-xs opacity-80">
                  {{ recoveryError }}
                </div>
              </div>
            </div>

            <button
              v-if="canRetryRecovery"
              type="button"
              class="inline-flex shrink-0 items-center rounded-xl border border-current/20 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isRecovering"
              @click="emit('retry-recovery')"
            >
              {{ t('conversationRecoveryRetry') }}
            </button>
          </div>

          <div v-for="(message, index) in conversation.messages" :key="message.id || index" class="space-y-4">
            <div
              v-if="message.role === 'user'"
              class="ml-auto max-w-[56rem] rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-card to-primary/[0.03] shadow-sm"
            >
              <div class="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                <div>
                  <div class="text-sm font-semibold text-foreground">{{ t('messageYou') }}</div>
                  <div class="text-sm text-muted-foreground">{{ t('conversationQuestionLabel') }}</div>
                </div>
                <div class="flex items-center gap-1">
                  <Button
                    v-if="isLatestUserMessage(index)"
                    size="sm"
                    variant="ghost"
                    class="rounded-full px-3"
                    :disabled="isLoading"
                    @click="isEditingLatestPrompt ? cancelEditingLatestPrompt() : startEditingLatestPrompt()"
                  >
                    <Pencil :size="14" />
                    {{ isEditingLatestPrompt ? t('settingsCancel') : t('conversationEditPrompt') }}
                  </Button>
                  <CopyButton
                    icon-only
                    :title="t('copyMessage')"
                    :get-text="() => (isLatestUserMessage(index) && isEditingLatestPrompt ? editingPrompt : (message as UserMessage).content)"
                  />
                </div>
              </div>
              <div class="px-5 py-5">
                <div v-if="isLatestUserMessage(index) && isEditingLatestPrompt" class="space-y-4">
                  <textarea
                    ref="editTextareaRef"
                    v-model="editingPrompt"
                    rows="4"
                    :placeholder="t('composerPlaceholder')"
                    class="min-h-[148px] w-full resize-none rounded-[1.4rem] border border-border/70 bg-background/80 px-4 py-3 text-[15px] leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/35"
                    @input="autosizeEditTextarea"
                    @keydown="handleEditKeydown"
                  />
                  <div class="flex justify-end gap-2">
                    <Button
                      size="sm"
                      class="rounded-full px-4"
                      :disabled="isLoading || !editingPrompt.trim()"
                      @click="handleRerun"
                    >
                      {{ t('conversationRunAgain') }}
                    </Button>
                  </div>
                </div>
                <MarkdownRenderer v-else :source="(message as UserMessage).content" class="prose-p:my-3" />
              </div>
            </div>

            <div v-else class="min-w-0 space-y-5">
              <div class="rounded-[1.45rem] border border-border/65 bg-background/60 px-5 py-4 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.35)] backdrop-blur">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-3">
                      <div class="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                        <MessageSquareText :size="16" class="text-primary" />
                        {{ t('assistantLabel') }}
                      </div>
                      <div :class="assistantStatusBadgeClass(assistantOverallStatus(message as AssistantMessage, index))">
                        <span
                          :class="
                            cn(
                              'h-2.5 w-2.5 rounded-full bg-current/40',
                              assistantOverallStatus(message as AssistantMessage, index) === 'running' && 'animate-pulse bg-current',
                              assistantOverallStatus(message as AssistantMessage, index) === 'complete' && 'bg-current',
                              assistantOverallStatus(message as AssistantMessage, index) === 'error' && 'bg-current',
                              assistantOverallStatus(message as AssistantMessage, index) === 'stopped' && 'bg-current',
                            )
                          "
                        />
                        {{ assistantStatusText(message as AssistantMessage, index) }}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                      <component :is="currentStageIcon(assistantCurrentStage(message as AssistantMessage, index))" :size="14" />
                      <span>{{ t('assistantSubtitle') }}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        v-for="pill in runConfigPills(message as AssistantMessage)"
                        :key="pill.key"
                        :title="pill.title"
                        class="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {{ pill.label }}
                      </span>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      v-if="isLatestAssistantMessage(index) && runStatus === 'running'"
                      size="sm"
                      variant="outline"
                      class="rounded-full"
                      @click="emit('stop')"
                    >
                      <Square :size="14" />
                      {{ t('conversationStop') }}
                    </Button>
                    <span
                      v-for="stage in visibleStagesForMessage(message as AssistantMessage)"
                      :key="stage"
                      :class="stageSummaryClass(stageStatuses(message as AssistantMessage, index)[stage as StageKey])"
                    >
                      <span :class="stageSummaryDotClass(stageStatuses(message as AssistantMessage, index)[stage as StageKey])" />
                      {{ stageTitle(stage as StageKey) }}
                    </span>
                  </div>
                </div>
              </div>

              <section
                v-if="shouldRenderStageSection(message as AssistantMessage, index, 'stage1')"
                :id="stageSectionId((message as AssistantMessage).id, 'stage1')"
                class="scroll-mt-24 space-y-4"
              >
                <div
                  v-if="
                    !((message as AssistantMessage).stage1 || Object.keys((message as AssistantMessage).stream?.stage1 || {}).length)
                  "
                  class="rounded-[1.6rem] border border-dashed border-border/70 bg-background/60 px-5 py-5"
                >
                  <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <LoaderCircle
                      v-if="(message as AssistantMessage).loading?.stage1 || isAssistantActiveTurn(index)"
                      :size="16"
                      class="animate-spin"
                    />
                    {{ t('stage1Subtitle') }}
                  </div>
                </div>

                <StageOneCard
                  v-if="(message as AssistantMessage).stage1 || Object.keys((message as AssistantMessage).stream?.stage1 || {}).length"
                  :responses="(message as AssistantMessage).stage1 || []"
                  :stream-state="(message as AssistantMessage).stream?.stage1"
                  :stream-meta="(message as AssistantMessage).streamMeta?.stage1"
                  :council-order="messageCouncilOrder(message as AssistantMessage)"
                />
              </section>

              <section
                v-if="shouldRenderStageSection(message as AssistantMessage, index, 'stage2')"
                :id="stageSectionId((message as AssistantMessage).id, 'stage2')"
                class="scroll-mt-24 space-y-4"
              >
                <div
                  v-if="
                    !((message as AssistantMessage).stage2 || Object.keys((message as AssistantMessage).stream?.stage2 || {}).length)
                  "
                  class="rounded-[1.6rem] border border-dashed border-border/70 bg-background/60 px-5 py-5"
                >
                  <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <LoaderCircle
                      v-if="(message as AssistantMessage).loading?.stage2"
                      :size="16"
                      class="animate-spin"
                    />
                    {{ (message as AssistantMessage).loading?.stage2 ? t('stage2Subtitle') : t('stageWaitingRanking') }}
                  </div>
                </div>

                <StageTwoCard
                  v-if="(message as AssistantMessage).stage2 || Object.keys((message as AssistantMessage).stream?.stage2 || {}).length"
                  :rankings="(message as AssistantMessage).stage2 || []"
                  :label-to-model="(message as AssistantMessage).metadata?.label_to_model"
                  :aggregate-rankings="(message as AssistantMessage).metadata?.aggregate_rankings"
                  :stream-state="(message as AssistantMessage).stream?.stage2"
                  :stream-meta="(message as AssistantMessage).streamMeta?.stage2"
                  :council-order="messageCouncilOrder(message as AssistantMessage)"
                />
              </section>

              <section
                v-if="shouldRenderStageSection(message as AssistantMessage, index, 'stage3')"
                :id="stageSectionId((message as AssistantMessage).id, 'stage3')"
                class="scroll-mt-24 space-y-4"
              >
                <div
                  v-if="
                    !(
                      (message as AssistantMessage).stage3 ||
                      (message as AssistantMessage).stream?.stage3?.response ||
                      (message as AssistantMessage).stream?.stage3?.thinking ||
                      (message as AssistantMessage).streamMeta?.stage3?.status === 'error'
                    )
                  "
                  class="rounded-[1.6rem] border border-dashed border-border/70 bg-background/60 px-5 py-5"
                >
                  <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <LoaderCircle
                      v-if="(message as AssistantMessage).loading?.stage3"
                      :size="16"
                      class="animate-spin"
                    />
                    {{ (message as AssistantMessage).loading?.stage3 ? t('stage3Subtitle') : t('stageWaitingSynthesis') }}
                  </div>
                </div>

                <StageThreeCard
                  v-if="(message as AssistantMessage).stage3 || (message as AssistantMessage).stream?.stage3?.response || (message as AssistantMessage).stream?.stage3?.thinking || (message as AssistantMessage).streamMeta?.stage3?.status === 'error'"
                  :final-response="(message as AssistantMessage).stage3"
                  :stream-state="(message as AssistantMessage).stream?.stage3"
                  :stream-meta="(message as AssistantMessage).streamMeta?.stage3"
                />
              </section>

              <TraceLog :metadata="tracePayloadForMessage(message as AssistantMessage)" />
            </div>
          </div>
        </div>

        <aside
          v-if="latestAssistantEntry"
          class="hidden lg:block"
        >
          <StageNavigation
            :stage-ids="{
              stage1: stageSectionId(latestAssistantEntry.message.id, 'stage1'),
              stage2: stageSectionId(latestAssistantEntry.message.id, 'stage2'),
              stage3: stageSectionId(latestAssistantEntry.message.id, 'stage3'),
            }"
            :stage-status="stageStatuses(latestAssistantEntry.message, latestAssistantEntry.index)"
            :available-stages="stageAvailability(latestAssistantEntry.message, latestAssistantEntry.index)"
          />
        </aside>
      </div>
    </div>
  </section>
</template>
