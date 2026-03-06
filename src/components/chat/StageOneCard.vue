<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, Sparkles } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageCard from './StageCard.vue'
import { cn } from '@/utils'

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
  responses: StageOneResponse[]
  streamState?: Record<string, ModelStreamState>
  streamMeta?: Record<string, ModelStreamMeta>
  councilOrder?: string[]
}>()

const { t } = useI18n()
const activeTab = ref(0)
const showThinking = ref(false)

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
const thinkingText = computed(
  () => activeResponse.value?.reasoning_details || activeStream.value?.thinking || '',
)

const hasStartedMainOutput = (model: string) => {
  const finalized = props.responses.find((response) => response.model === model)?.response
  const streamed = props.streamState?.[model]?.response
  return Boolean((finalized && finalized.length > 0) || (streamed && streamed.length > 0))
}

const isThinking = (model: string) =>
  props.streamMeta?.[model]?.status === 'running' && !hasStartedMainOutput(model)

const shortModelName = (model: string) => model.split('/')[1] || model
</script>

<template>
  <StageCard
    v-if="tabs.length > 0"
    :title="t('stage1Title')"
    :subtitle="t('stage1Subtitle')"
  >
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="(model, index) in tabs"
          :key="model"
          type="button"
          :class="
            cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors',
              activeTab === index
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )
          "
          @click="activeTab = index"
        >
          <span
            :class="
              cn(
                'h-2.5 w-2.5 rounded-full bg-muted-foreground/40',
                props.streamMeta?.[model]?.status === 'running' && 'bg-primary',
                props.streamMeta?.[model]?.status === 'complete' && 'bg-emerald-500',
                props.streamMeta?.[model]?.status === 'error' && 'bg-destructive',
              )
            "
          />
          <span>{{ shortModelName(model) }}</span>
          <span
            v-if="isThinking(model)"
            class="inline-flex items-center gap-1 text-xs font-medium text-primary"
          >
            <LoaderCircle :size="12" class="animate-spin" />
            {{ t('stageThinking') }}
          </span>
        </button>
      </div>

      <div class="overflow-hidden rounded-2xl border border-border/80 bg-muted/30">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles :size="16" class="text-primary" />
            {{ activeModel }}
          </div>
          <div class="flex items-center gap-2">
            <CopyButton icon-only :title="t('copyResponse')" :get-text="() => responseText" />
            <button
              type="button"
              class="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              @click="showThinking = !showThinking"
            >
              {{ showThinking ? t('stageHideThinking') : t('stageShowThinking') }}
            </button>
          </div>
        </div>

        <div class="space-y-4 p-4">
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
            class="prose-headings:mt-6 prose-p:my-3"
          />
          <div v-else class="rounded-xl border border-dashed border-border bg-background/80 px-4 py-5 text-sm text-muted-foreground">
            {{ t('stageWaitingResponse') }}
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
              class="prose-p:my-2 prose-headings:mt-4"
            />
            <div v-else class="text-sm text-muted-foreground">{{ t('stageNoThinking') }}</div>
          </div>
        </div>
      </div>
    </div>
  </StageCard>
</template>
