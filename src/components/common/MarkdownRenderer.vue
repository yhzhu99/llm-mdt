<script setup lang="ts">
import { computed } from 'vue'
import { parseMarkdown, sanitizeMarkdownHtml } from '@/utils/markdown'

const props = defineProps<{
  source: string
  class?: string
}>()

const renderedHtml = computed(() => sanitizeMarkdownHtml(parseMarkdown(props.source || '')))

const writeToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

const handleClick = async (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  const trigger = target?.closest<HTMLButtonElement>('[data-copy-code]')
  const encoded = trigger?.dataset.copyCode
  if (!trigger || !encoded) return

  const originalText = trigger.textContent || 'Copy'
  try {
    await writeToClipboard(decodeURIComponent(encoded))
    trigger.textContent = 'Copied'
  } catch (error) {
    console.error('Failed to copy code block', error)
    trigger.textContent = 'Failed'
  } finally {
    window.setTimeout(() => {
      trigger.textContent = originalText
    }, 1200)
  }
}
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
