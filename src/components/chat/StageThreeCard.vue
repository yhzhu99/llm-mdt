<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crown, LoaderCircle } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageCard from './StageCard.vue'
import { cn } from '@/utils'

interface StageThreeResult {
  model: string
  response: string
  reasoning_details?: string | null
}

interface StageThreeStreamState {
  response: string
  thinking: string
}

interface StageThreeStreamMeta {
  status: 'idle' | 'running' | 'complete' | 'error'
  message?: string
}

const props = defineProps<{
  id?: string
  finalResponse?: StageThreeResult | null
  streamState?: StageThreeStreamState
  streamMeta?: StageThreeStreamMeta
}>()

const { t } = useI18n()
const showThinking = ref(false)
const responseText = computed(() => props.finalResponse?.response || props.streamState?.response || '')
const thinkingText = computed(
  () => props.finalResponse?.reasoning_details || props.streamState?.thinking || '',
)
const modelName = computed(() => props.finalResponse?.model || 'chairman')
const hasStartedMainOutput = computed(() => Boolean(responseText.value))
const shortModelName = computed(() => modelName.value.split('/')[1] || modelName.value)
const statusDotClass = computed(() =>
  cn(
    'h-2.5 w-2.5 rounded-full bg-muted-foreground/40',
    props.streamMeta?.status === 'running' && 'bg-primary animate-pulse',
    (props.streamMeta?.status === 'complete' || props.finalResponse) && 'bg-emerald-500',
    props.streamMeta?.status === 'error' && 'bg-destructive',
  ),
)
</script>

<template>
  <StageCard
    v-if="responseText || thinkingText"
    :id="id"
    :title="t('stage3Title')"
    :subtitle="t('stage3Subtitle')"
  >
    <template #right>
      <div class="flex items-center gap-2">
        <CopyButton icon-only :title="t('copyFinalResponse')" :get-text="() => responseText" />
        <button
          type="button"
          class="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="showThinking = !showThinking"
        >
          {{ showThinking ? t('stageHideThinking') : t('stageShowThinking') }}
        </button>
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="props.streamMeta?.status === 'running' && !hasStartedMainOutput"
        class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
      >
        <LoaderCircle :size="14" class="animate-spin" />
        {{ t('stageThinkingEllipsis') }}
      </div>

      <div class="overflow-hidden rounded-2xl border border-border/80 bg-muted/30">
        <div class="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-medium text-foreground">
          <span :class="statusDotClass" />
          <Crown :size="16" class="text-primary" />
          {{ t('stageChairmanSynthesis') }} · {{ shortModelName }}
        </div>
        <div class="p-4">
          <MarkdownRenderer
            v-if="responseText"
            :source="responseText"
            :class="cn(props.streamMeta?.status === 'running' && 'streaming-prose', 'prose-headings:mt-6 prose-p:my-3')"
          />
          <div
            v-else-if="props.streamMeta?.status === 'error'"
            class="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-5 text-sm text-destructive"
          >
            {{ props.streamMeta?.message || t('stageStatusError') }}
          </div>
          <div v-else class="rounded-xl border border-dashed border-border bg-background/80 px-4 py-5 text-sm text-muted-foreground">
            {{ t('stageWaitingSynthesis') }}
          </div>
        </div>
      </div>

      <div
        v-if="showThinking"
        class="rounded-xl border border-border/80 bg-background/90 p-4"
      >
        <div class="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {{ t('stageThinking') }}
        </div>
        <MarkdownRenderer
          v-if="thinkingText"
          :source="thinkingText"
          :class="cn(props.streamMeta?.status === 'running' && 'streaming-prose', 'prose-p:my-2 prose-headings:mt-4')"
        />
        <div v-else class="text-sm text-muted-foreground">{{ t('stageNoThinking') }}</div>
      </div>
    </div>
  </StageCard>
</template>
