<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { LoaderCircle, MessageSquareText, Pencil, Settings2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { ChatCompletionDiagnostics } from '@/types'
import { cn } from '@/utils'
import Button from '@/components/ui/button/Button.vue'
import ChatComposer from './ChatComposer.vue'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageNavigation from './StageNavigation.vue'
import StageOneCard from './StageOneCard.vue'
import StageThreeCard from './StageThreeCard.vue'
import StageTwoCard from './StageTwoCard.vue'
import { orderModelsByReference } from '@/utils/conversations'

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
  diagnostics?: ChatCompletionDiagnostics | null
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
  (event: 'send', value: string): void
  (event: 'new-conversation'): void
  (event: 'open-settings'): void
  (event: 'rerun', value: string): void
  (event: 'retry-recovery'): void
  (event: 'stop'): void
}>()

const { locale, t } = useI18n()
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
const heroTitleLines = computed(() => {
  if (!props.providerConfigured) {
    return [t('configureBrowserProvider')]
  }

  if (locale.value === 'en') {
    return [t('welcomeTitleLine1'), t('welcomeTitleLine2')]
  }

  return [t('welcomeTitle')]
})
const heroTitleClass = computed(() =>
  !props.providerConfigured
    ? 'max-w-none whitespace-nowrap text-[clamp(1.5rem,7vw,4.5rem)]'
    : locale.value === 'en'
      ? 'max-w-[22ch] text-[clamp(2.25rem,4.4vw,4.5rem)]'
      : 'max-w-none text-[clamp(2.25rem,4.4vw,4.5rem)] md:whitespace-nowrap',
)

const messageTargetStage = (message: AssistantMessage): StageKey => message.runConfig?.targetStage || 'stage3'
const messageCouncilOrder = (message: AssistantMessage) => {
  const configuredOrder = props.runtimeConfig?.council_models || []
  const messageModels = message.runConfig?.councilModels?.length
    ? message.runConfig.councilModels
    : configuredOrder

  return orderModelsByReference(messageModels, configuredOrder)
}
const stageEnabledForMessage = (message: AssistantMessage, stage: StageKey) =>
  stageRank[stage] <= stageRank[messageTargetStage(message)]

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

const scrollRootId = 'chat-stage-scroll-root'
const emptyStageStatuses: Record<StageKey, StageStatus> = {
  stage1: 'waiting',
  stage2: 'waiting',
  stage3: 'waiting',
}
const emptyStageAvailability: Record<StageKey, boolean> = {
  stage1: false,
  stage2: false,
  stage3: false,
}

const handleSend = (value: string) => emit('send', value)
const handleTargetStageChange = (value: StageKey) => emit('update-target-stage', value)
const handleToggleModel = (model: string) => emit('toggle-model', model)
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
const questionSectionId = (messageId: string | undefined) => `${messageId || 'user'}-question`
const stageSectionId = (messageId: string | undefined, stage: StageKey) => `${messageId || 'assistant'}-${stage}`
const stageSummaryLabel = (stage: StageKey) => {
  if (stage === 'stage1') return `${t('stage1Title')} · ${t('stage1Subtitle')}`
  if (stage === 'stage2') return `${t('stage2Title')} · ${t('stage2Subtitle')}`
  return `${t('stage3Title')} · ${t('stage3Subtitle')}`
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

const latestQuestionId = computed(() =>
  latestUserEntry.value ? questionSectionId(latestUserEntry.value.message.id) : '',
)
const latestStageIds = computed(() => ({
  stage1: latestAssistantEntry.value ? stageSectionId(latestAssistantEntry.value.message.id, 'stage1') : '',
  stage2: latestAssistantEntry.value ? stageSectionId(latestAssistantEntry.value.message.id, 'stage2') : '',
  stage3: latestAssistantEntry.value ? stageSectionId(latestAssistantEntry.value.message.id, 'stage3') : '',
}))
const latestStageStatus = computed<Record<StageKey, StageStatus>>(() =>
  latestAssistantEntry.value
    ? stageStatuses(latestAssistantEntry.value.message, latestAssistantEntry.value.index)
    : emptyStageStatuses,
)
const latestStageAvailability = computed<Record<StageKey, boolean>>(() =>
  latestAssistantEntry.value
    ? stageAvailability(latestAssistantEntry.value.message, latestAssistantEntry.value.index)
    : emptyStageAvailability,
)
const shouldShowStageNavigation = computed(() => Boolean(latestUserEntry.value || latestAssistantEntry.value))

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
  <section class="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_32%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.92))]">
    <div v-if="!hasConversationMessages" class="flex-1 px-4 py-4 sm:px-6 sm:py-5">
      <div class="mx-auto flex min-h-full w-full max-w-[72rem] items-center">
        <div class="w-full space-y-5 py-6 sm:py-10">
          <div class="space-y-2">
            <h2
              :class="heroTitleClass"
              class="font-semibold leading-[0.95] tracking-[-0.05em] text-foreground"
            >
              <span
                v-for="(line, index) in heroTitleLines"
                :key="`${line}-${index}`"
                class="block"
              >
                {{ line }}
              </span>
            </h2>
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
            @toggle-model="handleToggleModel"
            @update:target-stage="handleTargetStageChange"
          />

          <div v-if="!providerConfigured" class="flex">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              @click="emit('open-settings')"
            >
              <Settings2 :size="16" />
              {{ t('openSettings') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="conversation"
      class="flex-1 min-h-0 px-4 py-4 sm:px-6 sm:py-5"
    >
      <div class="mx-auto grid h-full w-full max-w-[96rem] min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-6">
        <div
          :id="scrollRootId"
          ref="scrollRootRef"
          data-chat-scroll-root
          class="scrollbar-reveal min-h-0 overflow-y-auto pr-1 sm:pr-2"
        >
          <div class="min-w-0 space-y-6">
            <div
              v-if="shouldShowStageNavigation"
              class="lg:hidden"
            >
              <StageNavigation
                :question-id="latestQuestionId"
                :question-enabled="Boolean(latestQuestionId)"
                :stage-ids="latestStageIds"
                :stage-status="latestStageStatus"
                :available-stages="latestStageAvailability"
                :scroll-root-id="scrollRootId"
                :show-stop-button="runStatus === 'running'"
                @stop="emit('stop')"
              />
            </div>

            <div
              v-if="isRecovering || canRetryRecovery"
              :class="
                cn(
                  'flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border px-4 py-3 text-sm',
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
                :id="isLatestUserMessage(index) ? questionSectionId((message as UserMessage).id) : undefined"
                class="scroll-mt-24 ml-auto max-w-[58rem] rounded-[1.5rem] border border-primary/15 bg-gradient-to-br from-card via-card to-primary/[0.035] shadow-sm"
              >
                <div class="flex items-center justify-between gap-3 px-3 pt-3">
                  <div class="inline-flex items-center rounded-full border border-primary/15 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-medium text-primary/80">
                    {{ t('conversationQuestionLabel') }}
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      v-if="isLatestUserMessage(index)"
                      size="sm"
                      variant="ghost"
                      class="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
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
                <div class="px-4 pb-4 pt-2">
                  <div v-if="isLatestUserMessage(index) && isEditingLatestPrompt" class="space-y-4">
                    <textarea
                      ref="editTextareaRef"
                      v-model="editingPrompt"
                      rows="4"
                      :placeholder="t('composerPlaceholder')"
                      class="min-h-[132px] w-full resize-none rounded-[1.2rem] border border-border/70 bg-background/80 px-4 py-3 text-[15px] leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/35"
                      @input="autosizeEditTextarea"
                      @keydown="handleEditKeydown"
                    />
                    <div class="flex justify-end gap-2">
                      <Button
                        size="sm"
                        class="h-9 rounded-full px-4"
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

              <div v-else class="min-w-0 space-y-4">
                <section
                  v-if="shouldRenderStageSection(message as AssistantMessage, index, 'stage1')"
                  :id="stageSectionId((message as AssistantMessage).id, 'stage1')"
                  class="scroll-mt-24 space-y-4"
                >
                  <div
                    v-if="
                      !((message as AssistantMessage).stage1 || Object.keys((message as AssistantMessage).stream?.stage1 || {}).length)
                    "
                    class="rounded-[1.3rem] border border-dashed border-border/70 bg-background/60 px-4 py-4"
                  >
                    <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <LoaderCircle
                        v-if="(message as AssistantMessage).loading?.stage1 || isAssistantActiveTurn(index)"
                        :size="16"
                        class="animate-spin"
                      />
                      {{ stageSummaryLabel('stage1') }}
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
                    class="rounded-[1.3rem] border border-dashed border-border/70 bg-background/60 px-4 py-4"
                  >
                    <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <LoaderCircle
                        v-if="(message as AssistantMessage).loading?.stage2"
                        :size="16"
                        class="animate-spin"
                      />
                      {{ (message as AssistantMessage).loading?.stage2 ? stageSummaryLabel('stage2') : t('stageWaitingRanking') }}
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
                    class="rounded-[1.3rem] border border-dashed border-border/70 bg-background/60 px-4 py-4"
                  >
                    <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <LoaderCircle
                        v-if="(message as AssistantMessage).loading?.stage3"
                        :size="16"
                        class="animate-spin"
                      />
                      {{ (message as AssistantMessage).loading?.stage3 ? stageSummaryLabel('stage3') : t('stageWaitingSynthesis') }}
                    </div>
                  </div>

                  <StageThreeCard
                    v-if="(message as AssistantMessage).stage3 || (message as AssistantMessage).stream?.stage3?.response || (message as AssistantMessage).stream?.stage3?.thinking || (message as AssistantMessage).streamMeta?.stage3?.status === 'error'"
                    :final-response="(message as AssistantMessage).stage3"
                    :stream-state="(message as AssistantMessage).stream?.stage3"
                    :stream-meta="(message as AssistantMessage).streamMeta?.stage3"
                  />
                </section>
              </div>
            </div>
          </div>
        </div>

        <aside
          v-if="shouldShowStageNavigation"
          class="hidden lg:block"
        >
          <StageNavigation
            :question-id="latestQuestionId"
            :question-enabled="Boolean(latestQuestionId)"
            :stage-ids="latestStageIds"
            :stage-status="latestStageStatus"
            :available-stages="latestStageAvailability"
            :scroll-root-id="scrollRootId"
            :show-stop-button="runStatus === 'running'"
            @stop="emit('stop')"
          />
        </aside>
      </div>
    </div>
  </section>
</template>
