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
const thinkingText = computed(() => props.finalResponse?.reasoning_details || props.streamState?.thinking || '')
const modelName = computed(() => props.finalResponse?.model || 'chairman')
const hasStartedMainOutput = computed(() => Boolean(responseText.value))
const shortModelName = computed(() => modelName.value.split('/')[1] || modelName.value)

const stageStatus = computed(() => {
  if (props.streamMeta?.status === 'running') return 'running' as const
  if (props.finalResponse || props.streamMeta?.status === 'complete') return 'complete' as const
  if (props.streamMeta?.status === 'error') return 'error' as const
  return 'waiting' as const
})

const stageStatusLabel = computed(() => {
  if (stageStatus.value === 'running') return t('streaming')
  if (stageStatus.value === 'complete') return t('stageStatusComplete')
  if (stageStatus.value === 'error') return t('stageStatusError')
  return ''
})

const stageStatusBadgeClass = computed(() =>
  cn(
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
    stageStatus.value === 'running' && 'border-primary/20 bg-primary/10 text-primary',
    stageStatus.value === 'complete' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    stageStatus.value === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
    stageStatus.value === 'waiting' && 'border-border/70 bg-background/70 text-muted-foreground',
  ),
)
</script>

<template>
  <StageCard
    v-if="responseText || thinkingText || props.streamMeta?.status === 'error'"
    :id="id"
    :title="t('stage3Title')"
    :subtitle="t('stage3Subtitle')"
  >
    <template #right>
      <div v-if="stageStatusLabel" :class="stageStatusBadgeClass">
        <span
          :class="cn(
            'h-2.5 w-2.5 rounded-full bg-current/40',
            stageStatus === 'running' && 'animate-pulse bg-current',
            stageStatus === 'complete' && 'bg-current',
            stageStatus === 'error' && 'bg-current',
          )"
        />
        <span>{{ stageStatusLabel }}</span>
        <span class="text-current/80">· {{ shortModelName }}</span>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <CopyButton icon-only :title="t('copyFinalResponse')" :get-text="() => responseText" />
        <button
          type="button"
          class="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          @click="showThinking = !showThinking"
        >
          {{ showThinking ? t('stageHideThinking') : t('stageShowThinking') }}
        </button>
      </div>

      <div class="rounded-[1.4rem] border border-border/60 bg-background/70 p-4 sm:p-5">
        <div class="mb-4 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <span
            :class="
              cn(
                'h-2.5 w-2.5 rounded-full bg-muted-foreground/35',
                props.streamMeta?.status === 'running' && 'bg-primary animate-pulse',
                (props.streamMeta?.status === 'complete' || props.finalResponse) && 'bg-emerald-500',
                props.streamMeta?.status === 'error' && 'bg-destructive',
              )
            "
          />
          <Crown :size="16" class="text-primary" />
          <span>{{ t('stageChairmanSynthesis') }}</span>
          <span class="text-muted-foreground">· {{ shortModelName }}</span>
        </div>

        <div class="space-y-4">
          <div
            v-if="props.streamMeta?.status === 'running' && !hasStartedMainOutput"
            class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            <LoaderCircle :size="14" class="animate-spin" />
            {{ t('stageThinkingEllipsis') }}
          </div>

          <MarkdownRenderer
            v-if="responseText"
            :source="responseText"
            :class="cn(props.streamMeta?.status === 'running' && 'streaming-prose', 'prose-headings:mt-6 prose-p:my-3')"
          />
          <div
            v-else-if="props.streamMeta?.status === 'error'"
            class="rounded-[1rem] border border-destructive/20 bg-destructive/5 px-4 py-5 text-sm text-destructive"
          >
            {{ props.streamMeta?.message || t('stageStatusError') }}
          </div>
          <div
            v-else
            class="rounded-[1rem] border border-dashed border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground"
          >
            {{ t('stageWaitingSynthesis') }}
          </div>
        </div>
      </div>

      <div v-if="showThinking" class="rounded-[1.25rem] border border-border/60 bg-muted/20 px-4 py-4">
        <div class="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
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
