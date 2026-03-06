<script setup lang="ts">
import { computed } from 'vue'
import { Activity, Bot, CheckCheck, Crown, LoaderCircle, Scale, Sparkles } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { cn } from '@/utils'

interface StageOneResponse {
  model: string
}

interface StageTwoRanking {
  model: string
}

interface StageThreeResult {
  model: string
}

interface ModelStreamMeta {
  status: 'idle' | 'running' | 'complete' | 'error'
  message?: string
}

interface StageThreeStreamMeta {
  status: 'idle' | 'running' | 'complete' | 'error'
  message?: string
}

interface LoadingState {
  stage1?: boolean
  stage2?: boolean
  stage3?: boolean
}

type StageKey = 'stage1' | 'stage2' | 'stage3'
type OverviewStatus = 'waiting' | 'live' | 'complete' | 'error'

const props = defineProps<{
  stage1?: StageOneResponse[] | null
  stage2?: StageTwoRanking[] | null
  stage3?: StageThreeResult | null
  streamMeta?: {
    stage1?: Record<string, ModelStreamMeta>
    stage2?: Record<string, ModelStreamMeta>
    stage3?: StageThreeStreamMeta
  }
  loading?: LoadingState
  councilOrder?: string[]
  stageIds?: Partial<Record<StageKey, string>>
}>()

const { t } = useI18n()

const modelOrder = computed(() => {
  const preferred = props.councilOrder?.filter(Boolean) ?? []
  if (preferred.length > 0) return preferred

  return Array.from(
    new Set([
      ...(props.stage1 || []).map((item) => item.model),
      ...(props.stage2 || []).map((item) => item.model),
      ...Object.keys(props.streamMeta?.stage1 || {}),
      ...Object.keys(props.streamMeta?.stage2 || {}),
    ]),
  )
})

const summarizeModels = (
  meta: Record<string, ModelStreamMeta> | undefined,
  completedModels: string[],
  loading: boolean,
) => {
  const models = Array.from(new Set([...modelOrder.value, ...Object.keys(meta || {}), ...completedModels]))
  const liveModels: string[] = []
  let live = 0
  let complete = 0
  let error = 0

  for (const model of models) {
    const hasCompletedResult = completedModels.includes(model)
    const status = hasCompletedResult ? 'complete' : meta?.[model]?.status || 'idle'

    if (status === 'running') {
      live += 1
      liveModels.push(model)
    } else if (status === 'complete') {
      complete += 1
    } else if (status === 'error') {
      error += 1
    }
  }

  const total = models.length
  const waiting = Math.max(total - live - complete - error, 0)
  let status: OverviewStatus = 'waiting'

  if (live > 0 || loading) {
    status = 'live'
  } else if (error > 0 && complete === 0 && waiting === 0) {
    status = 'error'
  } else if (complete > 0 || (total > 0 && complete + error >= total)) {
    status = 'complete'
  }

  return {
    total,
    live,
    complete,
    error,
    waiting,
    status,
    liveModels,
  }
}

const stage1Summary = computed(() =>
  summarizeModels(
    props.streamMeta?.stage1,
    (props.stage1 || []).map((item) => item.model),
    Boolean(props.loading?.stage1),
  ),
)

const stage2Summary = computed(() =>
  summarizeModels(
    props.streamMeta?.stage2,
    (props.stage2 || []).map((item) => item.model),
    Boolean(props.loading?.stage2),
  ),
)

const stage3Summary = computed(() => {
  const chairmanModel = props.stage3?.model || 'chairman'
  const metaStatus = props.streamMeta?.stage3?.status || 'idle'
  const hasResult = Boolean(props.stage3)
  const isRunning = metaStatus === 'running' || Boolean(props.loading?.stage3)
  const hasError = metaStatus === 'error'

  return {
    total: 1,
    live: isRunning ? 1 : 0,
    complete: hasResult || metaStatus === 'complete' ? 1 : 0,
    error: hasError ? 1 : 0,
    waiting: !isRunning && !hasResult && !hasError ? 1 : 0,
    status: isRunning ? 'live' : hasError ? 'error' : hasResult || metaStatus === 'complete' ? 'complete' : 'waiting',
    liveModels: isRunning ? [chairmanModel] : [],
  }
})

const activeStage = computed<StageKey>(() => {
  if (['live', 'complete', 'error'].includes(stage3Summary.value.status)) return 'stage3'
  if (['live', 'complete', 'error'].includes(stage2Summary.value.status)) return 'stage2'
  return 'stage1'
})

const currentSummary = computed(() => {
  if (activeStage.value === 'stage3') return stage3Summary.value
  if (activeStage.value === 'stage2') return stage2Summary.value
  return stage1Summary.value
})

const stageCards = computed(() => [
  {
    key: 'stage1' as const,
    title: t('stage1Title'),
    subtitle: t('stage1Subtitle'),
    icon: Sparkles,
    summary: stage1Summary.value,
  },
  {
    key: 'stage2' as const,
    title: t('stage2Title'),
    subtitle: t('stage2Subtitle'),
    icon: Scale,
    summary: stage2Summary.value,
  },
  {
    key: 'stage3' as const,
    title: t('stage3Title'),
    subtitle: t('stage3Subtitle'),
    icon: Crown,
    summary: stage3Summary.value,
  },
])

const statusLabel = (status: OverviewStatus) => {
  if (status === 'live') return t('stageStatusLive')
  if (status === 'complete') return t('stageStatusComplete')
  if (status === 'error') return t('stageStatusError')
  return t('stageStatusWaiting')
}

const resolveStatusLabel = (status: string) => statusLabel(status as OverviewStatus)

const shortModelName = (model: string) => model.split('/')[1] || model

const scrollToStage = (stage: StageKey) => {
  const targetId = props.stageIds?.[stage]
  if (!targetId || typeof document === 'undefined') return

  document.getElementById(targetId)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}
</script>

<template>
  <section class="overflow-hidden rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-background to-background shadow-sm">
    <div class="border-b border-border/70 px-5 py-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
          <div class="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-background/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Activity :size="12" />
            {{ t('consultationLiveTitle') }}
          </div>
          <div>
            <div class="text-base font-semibold text-foreground">{{ t('consultationLiveSubtitle') }}</div>
            <div class="text-sm text-muted-foreground">
              {{ t('consultationTrackHint') }}
            </div>
          </div>
        </div>

        <div class="grid min-w-[240px] gap-2 sm:grid-cols-3">
          <div class="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {{ t('consultationCurrentStage') }}
            </div>
            <div class="mt-2 text-sm font-semibold text-foreground">
              {{ stageCards.find((stage) => stage.key === activeStage)?.title }}
            </div>
          </div>
          <div class="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {{ t('consultationLiveModels') }}
            </div>
            <div class="mt-2 text-sm font-semibold text-foreground">
              {{ currentSummary.live }}/{{ currentSummary.total || 1 }}
            </div>
          </div>
          <div class="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {{ t('consultationCompletedModels') }}
            </div>
            <div class="mt-2 text-sm font-semibold text-foreground">
              {{ currentSummary.complete }}/{{ currentSummary.total || 1 }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="currentSummary.liveModels.length"
        class="mt-4 flex flex-wrap items-center gap-2"
      >
        <span class="text-xs font-medium text-muted-foreground">{{ t('consultationCurrentFocus') }}</span>
        <span
          v-for="model in currentSummary.liveModels"
          :key="model"
          class="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
        >
          <LoaderCircle :size="12" class="animate-spin" />
          {{ shortModelName(model) }}
        </span>
      </div>
    </div>

    <div class="grid gap-3 px-5 py-4 md:grid-cols-3">
      <button
        v-for="stage in stageCards"
        :key="stage.key"
        type="button"
        :class="
          cn(
            'rounded-2xl border px-4 py-4 text-left transition-all duration-200',
            activeStage === stage.key
              ? 'border-primary/30 bg-primary/10 shadow-sm'
              : 'border-border/70 bg-background/80 hover:border-primary/20 hover:bg-primary/[0.04]',
          )
        "
        @click="scrollToStage(stage.key)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
            <component :is="stage.icon" :size="16" class="text-primary" />
            {{ stage.title }}
          </div>
          <span
            :class="
              cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium',
                stage.summary.status === 'live' && 'bg-primary/10 text-primary',
                stage.summary.status === 'complete' && 'bg-emerald-500/10 text-emerald-600',
                stage.summary.status === 'error' && 'bg-destructive/10 text-destructive',
                stage.summary.status === 'waiting' && 'bg-muted text-muted-foreground',
              )
            "
          >
            {{ resolveStatusLabel(stage.summary.status) }}
          </span>
        </div>

        <div class="mt-2 text-sm text-muted-foreground">
          {{ stage.subtitle }}
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            <Bot :size="12" />
            {{ stage.summary.total || (stage.key === 'stage3' ? 1 : 0) }}
          </span>
          <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            <LoaderCircle :size="12" :class="stage.summary.live > 0 ? 'animate-spin text-primary' : ''" />
            {{ t('consultationLiveModels') }} {{ stage.summary.live }}
          </span>
          <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            <CheckCheck :size="12" class="text-emerald-600" />
            {{ t('consultationCompletedModels') }} {{ stage.summary.complete }}
          </span>
        </div>
      </button>
    </div>
  </section>
</template>
