<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageCard from './StageCard.vue'
import { cn, pickBestReasoningText } from '@/utils'

interface StageOneResponse {
  model: string
  response: string
  reasoning_details?: string | null
}

interface ModelStreamState {
  response: string
  thinking: string
}

interface ModelStreamMeta {
  status: 'idle' | 'running' | 'complete' | 'error'
  message?: string
}

const props = defineProps<{
  id?: string
  responses: StageOneResponse[]
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
      ...props.responses.map((response) => response.model),
      ...Object.keys(props.streamState || {}),
      ...Object.keys(props.streamMeta || {}),
    ]),
  )
})

const activeModel = computed(() => tabs.value[Math.min(activeTab.value, Math.max(tabs.value.length - 1, 0))] || '')
const activeResponse = computed(
  () => props.responses.find((response) => response.model === activeModel.value) || null,
)
const activeStream = computed(() => (activeModel.value ? props.streamState?.[activeModel.value] : undefined))
const responseText = computed(() => activeResponse.value?.response || activeStream.value?.response || '')
const thinkingText = computed(() =>
  pickBestReasoningText(activeResponse.value?.reasoning_details, activeStream.value?.thinking),
)

const hasStartedMainOutput = (model: string) => {
  const finalized = props.responses.find((response) => response.model === model)?.response
  const streamed = props.streamState?.[model]?.response
  return Boolean((finalized && finalized.length > 0) || (streamed && streamed.length > 0))
}

const modelStatus = (model: string) => {
  if (props.responses.some((response) => response.model === model)) {
    return 'complete' as const
  }

  return props.streamMeta?.[model]?.status || 'idle'
}

const isThinking = (model: string) =>
  props.streamMeta?.[model]?.status === 'running' && !hasStartedMainOutput(model)

const shortModelName = (model: string) => model.split('/')[1] || model

const stageStatus = computed(() => {
  if (tabs.value.some((model) => modelStatus(model) === 'running')) return 'running' as const
  if (props.responses.length > 0) return 'complete' as const
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
    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
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
  () => [props.responses, props.streamMeta, props.streamState] as const,
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
  <StageCard v-if="tabs.length > 0" :id="id" :title="t('stage1Title')" :subtitle="t('stage1Subtitle')">
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
      </div>
    </template>

    <div class="space-y-3">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div class="flex min-w-0 flex-wrap gap-2">
          <button
            v-for="(model, index) in tabs"
            :key="model"
            type="button"
            :class="
              cn(
                'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
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
          <CopyButton icon-only :title="t('copyResponse')" :get-text="() => responseText" />
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            @click="showThinking = !showThinking"
          >
            {{ showThinking ? t('stageHideThinking') : t('stageShowThinking') }}
          </button>
        </div>
      </div>

      <div class="rounded-[1.25rem] border border-border/60 bg-background/70 p-4">
        <div class="space-y-4">
          <div
            v-if="isThinking(activeModel)"
            class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            <LoaderCircle :size="14" class="animate-spin" />
            {{ t('stageThinkingEllipsis') }}
          </div>

          <MarkdownRenderer
            v-if="responseText"
            :source="responseText"
            :class="cn(modelStatus(activeModel) === 'running' && 'streaming-prose', 'prose-headings:mt-6 prose-p:my-3')"
          />
          <div
            v-else-if="modelStatus(activeModel) === 'error'"
            class="rounded-[1rem] border border-destructive/20 bg-destructive/5 px-4 py-4 text-sm text-destructive"
          >
            {{ props.streamMeta?.[activeModel]?.message || t('stageStatusError') }}
          </div>
          <div
            v-else
            class="rounded-[1rem] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground"
          >
            {{ t('stageWaitingResponse') }}
          </div>
        </div>
      </div>

      <div v-if="showThinking" class="rounded-[1.05rem] border border-border/60 bg-muted/20 px-4 py-3.5">
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
    </div>
  </StageCard>
</template>
