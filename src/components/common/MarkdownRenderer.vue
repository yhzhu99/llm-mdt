<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from '@/i18n'
import { COPY_FEEDBACK_DURATION_MS, writeTextToClipboard } from '@/utils/clipboard'
import { parseMarkdown, sanitizeMarkdownHtml } from '@/utils/markdown'

const props = defineProps<{
  source: string
  class?: string
}>()

const { t } = useI18n()

const renderedHtml = computed(() =>
  sanitizeMarkdownHtml(
    parseMarkdown(props.source || '', {
      code: t('markdownCode'),
      copy: t('copy'),
      copied: t('copied'),
      copyFailed: t('copyFailed'),
    }),
  ),
)

const resetTimers = new Map<HTMLElement, number>()

const clearResetTimer = (trigger: HTMLElement) => {
  const activeTimer = resetTimers.get(trigger)
  if (activeTimer !== undefined) {
    window.clearTimeout(activeTimer)
    resetTimers.delete(trigger)
  }
}

const handleClick = async (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  const trigger = target?.closest<HTMLButtonElement>('[data-copy-code]')
  const encoded = trigger?.dataset.copyCode
  if (!trigger || !encoded) return

  const badge = trigger.parentElement?.querySelector<HTMLElement>('[data-copy-feedback]')
  const setFeedback = (state: 'success' | 'error', message: string) => {
    trigger.dataset.copyState = state
    if (badge) {
      badge.dataset.state = state
      badge.dataset.visible = 'true'
      badge.textContent = message
    }

    clearResetTimer(trigger)
    const timer = window.setTimeout(() => {
      trigger.dataset.copyState = 'idle'
      if (badge) {
        badge.dataset.state = 'idle'
        badge.dataset.visible = 'false'
        badge.textContent = ''
      }
      resetTimers.delete(trigger)
    }, COPY_FEEDBACK_DURATION_MS)
    resetTimers.set(trigger, timer)
  }

  try {
    await writeTextToClipboard(decodeURIComponent(encoded))
    setFeedback('success', trigger.dataset.copySuccess || t('copied'))
  } catch (error) {
    console.error('Failed to copy code block', error)
    setFeedback('error', trigger.dataset.copyError || t('copyFailed'))
  }
}

onBeforeUnmount(() => {
  resetTimers.forEach((timer) => {
    window.clearTimeout(timer)
  })
  resetTimers.clear()
})
</script>

<template>
  <div
    :class="['prose prose-slate max-w-none text-sm leading-7 sm:text-[15px]', props.class]"
    @click="handleClick"
    v-html="renderedHtml"
  />
</template>

<style scoped>
:deep(.md-codeblock .shiki) {
  margin: 0;
  overflow-x: auto;
  background: transparent !important;
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.6;
}

:deep(.md-codeblock .shiki code) {
  background: transparent;
  padding: 0;
}
</style>
