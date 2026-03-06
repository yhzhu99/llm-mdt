<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { LoaderCircle, MessageSquareText, Settings2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import ChatComposer from './ChatComposer.vue'
import ConsultationOverview from './ConsultationOverview.vue'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
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
}

interface ConversationDetail {
  id: string
  title: string
  messages: Array<UserMessage | AssistantMessage>
}

interface RuntimeConfigLike {
  council_models?: string[]
}

const props = withDefaults(
  defineProps<{
    conversation?: ConversationDetail | null
    draft?: string
    isLoading?: boolean
    runtimeConfig?: RuntimeConfigLike | null
    providerConfigured?: boolean
  }>(),
  {
    conversation: null,
    draft: '',
    isLoading: false,
    runtimeConfig: null,
    providerConfigured: false,
  },
)

const emit = defineEmits<{
  (event: 'update:draft', value: string): void
  (event: 'send', value: string): void
  (event: 'open-settings'): void
}>()

const { t } = useI18n()
const messagesContainer = ref<HTMLElement | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)

const draftValue = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value),
})

const councilOrder = computed(() => props.runtimeConfig?.council_models || [])

const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
  messagesEnd.value?.scrollIntoView({ behavior, block: 'end' })
}

watch(
  () => props.conversation,
  async () => {
    await nextTick()
    const container = messagesContainer.value
    if (!container) return
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceToBottom <= 160) {
      scrollToBottom('smooth')
    }
  },
  { deep: true },
)

watch(
  () => props.isLoading,
  async (isLoading) => {
    if (!isLoading) return
    await nextTick()
    const container = messagesContainer.value
    if (!container) return
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceToBottom <= 220) {
      scrollToBottom('auto')
    }
  },
)

const handleSend = (value: string) => emit('send', value)
const stageSectionId = (messageId: string | undefined, stage: 'stage1' | 'stage2' | 'stage3') =>
  `${messageId || 'assistant'}-${stage}`

const isAssistantStreaming = (message: AssistantMessage) =>
  Boolean(message.loading?.stage1 || message.loading?.stage2 || message.loading?.stage3)
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),_transparent_42%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(248,250,252,0.75))]">
    <div
      ref="messagesContainer"
      class="scrollbar-hide flex-1 overflow-y-auto px-5 py-6 sm:px-6"
    >
      <div
        v-if="!conversation"
        class="mx-auto flex min-h-full max-w-5xl items-center justify-center"
      >
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
            :provider-configured="providerConfigured"
            @open-settings="emit('open-settings')"
            @send="handleSend"
          />

          <div
            v-if="!providerConfigured"
            class="flex justify-center"
          >
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

      <div v-else class="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div
          v-if="conversation.messages.length === 0"
          class="rounded-[1.75rem] border border-dashed border-border bg-background/90 px-6 py-10 text-center"
        >
          <div class="text-lg font-semibold text-foreground">{{ t('startConversation') }}</div>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            {{ t('askCouncilQuestion') }}
          </p>
        </div>

        <div
          v-for="(message, index) in conversation.messages"
          :key="message.id || index"
          class="space-y-4"
        >
          <div
            v-if="message.role === 'user'"
            class="ml-auto max-w-4xl rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-card to-primary/[0.03] shadow-sm"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div>
                <div class="text-sm font-semibold text-foreground">{{ t('messageYou') }}</div>
                <div class="text-sm text-muted-foreground">{{ t('conversationQuestionLabel') }}</div>
              </div>
              <CopyButton icon-only :title="t('copyMessage')" :get-text="() => (message as UserMessage).content" />
            </div>
            <div class="px-5 py-5">
              <MarkdownRenderer :source="(message as UserMessage).content" class="prose-p:my-3" />
            </div>
          </div>

          <div
            v-else
            class="space-y-5 rounded-[1.9rem] border border-border/80 bg-background/90 p-5 shadow-soft backdrop-blur"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
              <div>
                <div class="text-sm font-semibold text-foreground">{{ t('assistantLabel') }}</div>
                <div class="text-sm text-muted-foreground">
                  {{ t('assistantSubtitle') }}
                </div>
              </div>
              <div
                v-if="isAssistantStreaming(message as AssistantMessage)"
                class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              >
                <LoaderCircle :size="14" class="animate-spin" />
                {{ t('streaming') }}
              </div>
            </div>

            <div class="space-y-4">
              <ConsultationOverview
                :stage1="(message as AssistantMessage).stage1"
                :stage2="(message as AssistantMessage).stage2"
                :stage3="(message as AssistantMessage).stage3"
                :stream-meta="(message as AssistantMessage).streamMeta"
                :loading="(message as AssistantMessage).loading"
                :council-order="councilOrder"
                :stage-ids="{
                  stage1: stageSectionId((message as AssistantMessage).id, 'stage1'),
                  stage2: stageSectionId((message as AssistantMessage).id, 'stage2'),
                  stage3: stageSectionId((message as AssistantMessage).id, 'stage3'),
                }"
              />

              <div
                v-if="(message as AssistantMessage).loading?.stage1 && !Object.keys((message as AssistantMessage).stream?.stage1 || {}).length"
                class="rounded-2xl border border-border/80 bg-muted/30 px-5 py-5"
              >
                <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <LoaderCircle :size="16" class="animate-spin" />
                  {{ t('stage1Subtitle') }}
                </div>
              </div>

              <StageOneCard
                v-if="(message as AssistantMessage).stage1 || Object.keys((message as AssistantMessage).stream?.stage1 || {}).length"
                :id="stageSectionId((message as AssistantMessage).id, 'stage1')"
                :responses="(message as AssistantMessage).stage1 || []"
                :stream-state="(message as AssistantMessage).stream?.stage1"
                :stream-meta="(message as AssistantMessage).streamMeta?.stage1"
                :council-order="councilOrder"
              />

              <div
                v-if="(message as AssistantMessage).loading?.stage2 && !Object.keys((message as AssistantMessage).stream?.stage2 || {}).length"
                class="rounded-2xl border border-border/80 bg-muted/30 px-5 py-5"
              >
                <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <LoaderCircle :size="16" class="animate-spin" />
                  {{ t('stage2Subtitle') }}
                </div>
              </div>

              <StageTwoCard
                v-if="(message as AssistantMessage).stage2 || Object.keys((message as AssistantMessage).stream?.stage2 || {}).length"
                :id="stageSectionId((message as AssistantMessage).id, 'stage2')"
                :rankings="(message as AssistantMessage).stage2 || []"
                :label-to-model="(message as AssistantMessage).metadata?.label_to_model"
                :aggregate-rankings="(message as AssistantMessage).metadata?.aggregate_rankings"
                :stream-state="(message as AssistantMessage).stream?.stage2"
                :stream-meta="(message as AssistantMessage).streamMeta?.stage2"
                :council-order="councilOrder"
              />

              <div
                v-if="(message as AssistantMessage).loading?.stage3 && !((message as AssistantMessage).stream?.stage3?.response || (message as AssistantMessage).stream?.stage3?.thinking)"
                class="rounded-2xl border border-border/80 bg-muted/30 px-5 py-5"
              >
                <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <LoaderCircle :size="16" class="animate-spin" />
                  {{ t('stage3Subtitle') }}
                </div>
              </div>

              <StageThreeCard
                v-if="(message as AssistantMessage).stage3 || (message as AssistantMessage).stream?.stage3?.response || (message as AssistantMessage).stream?.stage3?.thinking"
                :id="stageSectionId((message as AssistantMessage).id, 'stage3')"
                :final-response="(message as AssistantMessage).stage3"
                :stream-state="(message as AssistantMessage).stream?.stage3"
                :stream-meta="(message as AssistantMessage).streamMeta?.stage3"
              />

              <TraceLog :metadata="(message as AssistantMessage).metadata" />
            </div>
          </div>
        </div>

        <div ref="messagesEnd" />
      </div>
    </div>

    <div v-if="conversation" class="border-t border-border/70 bg-background/80 px-5 py-4 backdrop-blur sm:px-6">
      <div class="mx-auto w-full max-w-6xl">
        <ChatComposer
          v-model="draftValue"
          :disabled="isLoading"
          :is-loading="isLoading"
          :provider-configured="providerConfigured"
          @open-settings="emit('open-settings')"
          @send="handleSend"
        />
      </div>
    </div>
  </section>
</template>
