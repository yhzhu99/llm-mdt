<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDownWideNarrow, LoaderCircle, Scale } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageCard from './StageCard.vue'
import { cn, pickBestReasoningText } from '@/utils'

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

interface ModelStreamState {
  ranking: string
  thinking: string
}

interface ModelStreamMeta {
  status: 'idle' | 'running' | 'complete' | 'error'
  message?: string
}

const props = defineProps<{
  id?: string
  rankings: StageTwoRanking[]
  labelToModel?: Record<string, string>
  aggregateRankings?: AggregateRanking[]
  streamState?: Record<string, ModelStreamState>
  streamMeta?: Record<string, ModelStreamMeta>
  councilOrder?: string[]
}>()

const { t } = useI18n()
const activeTab = ref(0)
const showThinking = ref(false)
const manualSelection = ref(false)

const tabs = computed(() => {
  const preferred = props.councilOrder?.filter(Boolean) ?? []
  if (preferred.length > 0) return preferred

  return Array.from(
    new Set([
      ...props.rankings.map((ranking) => ranking.model),
      ...Object.keys(props.streamState || {}),
      ...Object.keys(props.streamMeta || {}),
    ]),
  )
})

const activeModel = computed(() => tabs.value[Math.min(activeTab.value, Math.max(tabs.value.length - 1, 0))] || '')
const activeRanking = computed(
  () => props.rankings.find((ranking) => ranking.model === activeModel.value) || null,
)
const activeStream = computed(() => (activeModel.value ? props.streamState?.[activeModel.value] : undefined))

const deAnonymizeText = (text: string) => {
  let result = text
  for (const [label, model] of Object.entries(props.labelToModel || {})) {
    result = result.replaceAll(label, `**${model.split('/')[1] || model}**`)
  }
  return result
}

const rankingText = computed(() => activeRanking.value?.ranking || activeStream.value?.ranking || '')
const displayRankingText = computed(() => deAnonymizeText(rankingText.value))
const thinkingText = computed(
  () => deAnonymizeText(pickBestReasoningText(activeRanking.value?.reasoning_details, activeStream.value?.thinking)),
)

const hasStartedMainOutput = (model: string) => {
  const finalized = props.rankings.find((ranking) => ranking.model === model)?.ranking
  const streamed = props.streamState?.[model]?.ranking
  return Boolean((finalized && finalized.length > 0) || (streamed && streamed.length > 0))
}

const modelStatus = (model: string) => {
  if (props.rankings.some((ranking) => ranking.model === model)) {
    return 'complete' as const
  }

  return props.streamMeta?.[model]?.status || 'idle'
}

const isThinking = (model: string) =>
  props.streamMeta?.[model]?.status === 'running' && !hasStartedMainOutput(model)

const shortModelName = (model: string) => model.split('/')[1] || model

const stageStatus = computed(() => {
  if (tabs.value.some((model) => modelStatus(model) === 'running')) return 'running' as const
  if (props.rankings.length > 0) return 'complete' as const
  if (tabs.value.some((model) => modelStatus(model) === 'error')) return 'error' as const
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

watch(
  tabs,
  (models) => {
    if (!models.length) {
      activeTab.value = 0
      return
    }

    if (models[activeTab.value]) return
    activeTab.value = 0
  },
  { immediate: true },
)

watch(
  () => [props.rankings, props.streamMeta, props.streamState] as const,
  () => {
    if (!tabs.value.length) return
    if (manualSelection.value && tabs.value[activeTab.value]) return

    const nextModel =
      tabs.value.find((model) => props.streamMeta?.[model]?.status === 'running') ||
      tabs.value.find((model) => hasStartedMainOutput(model)) ||
      tabs.value[0]

    if (!nextModel) return

    const nextIndex = tabs.value.indexOf(nextModel)
    if (nextIndex >= 0) {
      activeTab.value = nextIndex
    }
  },
  { deep: true, immediate: true },
)

const selectModel = (index: number) => {
  manualSelection.value = true
  activeTab.value = index
}
</script>

<template>
  <StageCard v-if="tabs.length > 0" :id="id" :title="t('stage2Title')" :subtitle="t('stage2Subtitle')">
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
        <span v-if="activeModel" class="text-current/80">· {{ shortModelName(activeModel) }}</span>
      </div>
    </template>

    <div class="space-y-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div class="flex min-w-0 flex-wrap gap-2">
          <button
            v-for="(model, index) in tabs"
            :key="model"
            type="button"
            :class="
              cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                activeTab === index
                  ? 'border-primary/25 bg-primary/10 text-primary'
                  : 'border-border/70 bg-background/70 text-muted-foreground hover:border-border hover:text-foreground',
              )
            "
            @click="selectModel(index)"
          >
            <span
              :class="
                cn(
                  'h-2.5 w-2.5 rounded-full bg-muted-foreground/35',
                  modelStatus(model) === 'running' && 'bg-primary animate-pulse',
                  modelStatus(model) === 'complete' && 'bg-emerald-500',
                  modelStatus(model) === 'error' && 'bg-destructive',
                )
              "
            />
            <span>{{ shortModelName(model) }}</span>
          </button>
        </div>

        <div class="flex items-center justify-end gap-2 lg:pl-4">
          <CopyButton icon-only :title="t('copyRanking')" :get-text="() => rankingText" />
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            @click="showThinking = !showThinking"
          >
            {{ showThinking ? t('stageHideThinking') : t('stageShowThinking') }}
          </button>
        </div>
      </div>

      <div class="rounded-[1.4rem] border border-border/60 bg-background/70 p-4 sm:p-5">
        <div class="mb-4 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <span
            :class="
              cn(
                'h-2.5 w-2.5 rounded-full bg-muted-foreground/35',
                modelStatus(activeModel) === 'running' && 'bg-primary animate-pulse',
                modelStatus(activeModel) === 'complete' && 'bg-emerald-500',
                modelStatus(activeModel) === 'error' && 'bg-destructive',
              )
            "
          />
          <Scale :size="16" class="text-primary" />
          <span>{{ shortModelName(activeModel) }}</span>
        </div>

        <div class="space-y-4">
          <div
            v-if="isThinking(activeModel)"
            class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            <LoaderCircle :size="14" class="animate-spin" />
            {{ t('stageThinkingEllipsis') }}
          </div>

          <MarkdownRenderer
            v-if="displayRankingText"
            :source="displayRankingText"
            :class="cn(modelStatus(activeModel) === 'running' && 'streaming-prose', 'prose-headings:mt-6 prose-p:my-3')"
          />
          <div
            v-else-if="modelStatus(activeModel) === 'error'"
            class="rounded-[1rem] border border-destructive/20 bg-destructive/5 px-4 py-5 text-sm text-destructive"
          >
            {{ props.streamMeta?.[activeModel]?.message || t('stageStatusError') }}
          </div>
          <div
            v-else
            class="rounded-[1rem] border border-dashed border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground"
          >
            {{ t('stageWaitingRanking') }}
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
          :class="cn(props.streamMeta?.[activeModel]?.status === 'running' && 'streaming-prose', 'prose-p:my-2 prose-headings:mt-4')"
        />
        <div v-else class="text-sm text-muted-foreground">{{ t('stageNoThinking') }}</div>
      </div>

      <div
        v-if="activeRanking?.parsed_ranking?.length"
        class="rounded-[1.25rem] border border-border/60 bg-muted/15 px-4 py-4"
      >
        <div class="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <ArrowDownWideNarrow :size="16" class="text-primary" />
          {{ t('stageExtractedRanking') }}
        </div>
        <ol class="space-y-2 text-sm text-muted-foreground">
          <li
            v-for="(label, index) in activeRanking.parsed_ranking"
            :key="`${label}-${index}`"
            class="flex items-center gap-3"
          >
            <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
              {{ index + 1 }}
            </span>
            <span>{{ props.labelToModel?.[label] ? shortModelName(props.labelToModel[label]) : label }}</span>
          </li>
        </ol>
      </div>

      <div
        v-if="props.aggregateRankings?.length"
        class="rounded-[1.25rem] border border-border/60 bg-muted/15 px-4 py-4"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <div class="text-sm font-semibold text-foreground">{{ t('stageAggregateRankings') }}</div>
          <CopyButton
            icon-only
            :title="t('copyAggregateRankings')"
            :get-text="() => JSON.stringify(props.aggregateRankings, null, 2)"
          />
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <div
            v-for="(aggregate, index) in props.aggregateRankings"
            :key="aggregate.model"
            class="rounded-[1rem] border border-border/60 bg-background/70 px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  #{{ index + 1 }}
                </div>
                <div class="mt-1 text-sm font-semibold text-foreground">
                  {{ shortModelName(aggregate.model) }}
                </div>
              </div>
              <div class="text-right text-sm text-muted-foreground">
                <div>{{ t('stageAverageRank', { value: aggregate.average_rank.toFixed(2) }) }}</div>
                <div>{{ t('stageVotes', { count: aggregate.rankings_count }) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </StageCard>
</template>
