<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { LoaderCircle, Settings2 } from 'lucide-vue-next'
import ChatComposer from './ChatComposer.vue'
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

const messagesContainer = ref<HTMLElement | null>(null)
const messagesEnd = ref<HTMLElement | null>(null)

const draftValue = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value),
})

const councilOrder = computed(() => props.runtimeConfig?.council_models || [])
const isSingleTurnLocked = computed(() =>
  Boolean(props.conversation?.messages.some((message) => message.role === 'user')),
)

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
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-muted/20">
    <div
      ref="messagesContainer"
      class="scrollbar-hide flex-1 overflow-y-auto px-5 py-6 sm:px-6"
    >
      <div
        v-if="!conversation && !providerConfigured"
        class="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-6 text-center"
      >
        <div class="space-y-3">
          <div class="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
            Provider setup required
          </div>
          <h2 class="text-3xl font-semibold tracking-tight text-foreground">
            Configure your browser provider
          </h2>
          <p class="text-base leading-7 text-muted-foreground">
            LLM MDT runs entirely in your browser and stores settings locally on this device.
          </p>
        </div>

        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="emit('open-settings')"
        >
          <Settings2 :size="16" />
          Open settings
        </button>
      </div>

      <div
        v-else-if="!conversation"
        class="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center gap-8"
      >
        <div class="space-y-3 text-center">
          <div class="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-muted-foreground shadow-sm">
            Browser-native MDT workflow
          </div>
          <h2 class="text-4xl font-semibold tracking-tight text-foreground">
            Welcome to LLM MDT
          </h2>
          <p class="mx-auto max-w-2xl text-base leading-7 text-muted-foreground">
            Ask one question to consult the model council. The app streams each stage so you can
            inspect individual answers, peer review, and the chairman synthesis.
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
      </div>

      <div v-else class="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div v-if="conversation.messages.length === 0" class="rounded-[1.75rem] border border-dashed border-border bg-background/90 px-6 py-10 text-center">
          <div class="text-lg font-semibold text-foreground">Start a conversation</div>
          <p class="mt-2 text-sm text-muted-foreground">
            Ask a question to consult the LLM MDT council.
          </p>
        </div>

        <div
          v-for="(message, index) in conversation.messages"
          :key="message.id || index"
          class="space-y-4"
        >
          <div
            v-if="message.role === 'user'"
            class="ml-auto max-w-3xl rounded-[1.75rem] border border-border/80 bg-card shadow-sm"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div class="text-sm font-semibold text-foreground">You</div>
              <CopyButton icon-only title="Copy message" :get-text="() => (message as UserMessage).content" />
            </div>
            <div class="px-5 py-5">
              <MarkdownRenderer :source="(message as UserMessage).content" class="prose-p:my-3" />
            </div>
          </div>

          <div
            v-else
            class="space-y-4 rounded-[1.75rem] border border-border/80 bg-card p-5 shadow-sm"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
              <div>
                <div class="text-sm font-semibold text-foreground">LLM MDT</div>
                <div class="text-sm text-muted-foreground">
                  Staged council response
                </div>
              </div>
              <div
                v-if="(message as AssistantMessage).loading?.stage1 || (message as AssistantMessage).loading?.stage2 || (message as AssistantMessage).loading?.stage3"
                class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              >
                <LoaderCircle :size="14" class="animate-spin" />
                Streaming
              </div>
            </div>

            <div class="space-y-4">
              <div
                v-if="(message as AssistantMessage).loading?.stage1 && !Object.keys((message as AssistantMessage).stream?.stage1 || {}).length"
                class="rounded-2xl border border-border/80 bg-muted/30 px-5 py-5"
              >
                <div class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <LoaderCircle :size="16" class="animate-spin" />
                  Collecting individual model responses…
                </div>
              </div>

              <StageOneCard
                v-if="(message as AssistantMessage).stage1 || Object.keys((message as AssistantMessage).stream?.stage1 || {}).length"
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
                  Evaluating peer rankings…
                </div>
              </div>

              <StageTwoCard
                v-if="(message as AssistantMessage).stage2 || Object.keys((message as AssistantMessage).stream?.stage2 || {}).length"
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
                  Preparing final synthesis…
                </div>
              </div>

              <StageThreeCard
                v-if="(message as AssistantMessage).stage3 || (message as AssistantMessage).stream?.stage3?.response || (message as AssistantMessage).stream?.stage3?.thinking"
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

    <div v-if="!isSingleTurnLocked" class="border-t border-border/80 bg-background/90 px-5 py-5 backdrop-blur sm:px-6">
      <div class="mx-auto max-w-5xl">
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
