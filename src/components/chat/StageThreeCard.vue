<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crown, LoaderCircle } from 'lucide-vue-next'
import CopyButton from '@/components/common/CopyButton.vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import StageCard from './StageCard.vue'

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
  finalResponse?: StageThreeResult | null
  streamState?: StageThreeStreamState
  streamMeta?: StageThreeStreamMeta
}>()

const showThinking = ref(false)
const responseText = computed(() => props.finalResponse?.response || props.streamState?.response || '')
const thinkingText = computed(
  () => props.finalResponse?.reasoning_details || props.streamState?.thinking || '',
)
const modelName = computed(() => props.finalResponse?.model || 'chairman')
const hasStartedMainOutput = computed(() => Boolean(responseText.value))
const statusText = computed(() => {
  if (props.streamMeta?.status === 'error') return 'Error'
  if (props.streamMeta?.status === 'complete' || props.finalResponse) return 'Complete'
  if (!hasStartedMainOutput.value) return 'Thinking'
  return 'Generating'
})
</script>

<template>
  <StageCard
    v-if="responseText || thinkingText"
    title="Stage 3"
    :subtitle="`Final synthesis (${modelName.split('/')[1] || modelName}) · ${statusText}`"
  >
    <template #right>
      <div class="flex items-center gap-2">
        <CopyButton icon-only title="Copy final response" :get-text="() => responseText" />
        <button
          type="button"
          class="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="showThinking = !showThinking"
        >
          {{ showThinking ? 'Hide thinking' : 'Show thinking' }}
        </button>
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="props.streamMeta?.status === 'running' && !hasStartedMainOutput"
        class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
      >
        <LoaderCircle :size="14" class="animate-spin" />
        Thinking…
      </div>

      <div class="overflow-hidden rounded-2xl border border-border/80 bg-muted/30">
        <div class="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-medium text-foreground">
          <Crown :size="16" class="text-primary" />
          Chairman synthesis
        </div>
        <div class="p-4">
          <MarkdownRenderer
            v-if="responseText"
            :source="responseText"
            class="prose-headings:mt-6 prose-p:my-3"
          />
          <div v-else class="rounded-xl border border-dashed border-border bg-background/80 px-4 py-5 text-sm text-muted-foreground">
            Waiting for final synthesis…
          </div>
        </div>
      </div>

      <div
        v-if="showThinking"
        class="rounded-xl border border-border/80 bg-background/90 p-4"
      >
        <div class="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Thinking
        </div>
        <MarkdownRenderer
          v-if="thinkingText"
          :source="thinkingText"
          class="prose-p:my-2 prose-headings:mt-4"
        />
        <div v-else class="text-sm text-muted-foreground">
          Model did not provide thinking / reasoning.
        </div>
      </div>
    </div>
  </StageCard>
</template>
