<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { cn } from '@/utils'

const props = withDefaults(
  defineProps<{
    getText: () => string | Promise<string>
    label?: string
    successLabel?: string
    title?: string
    iconOnly?: boolean
    class?: string
  }>(),
  {
    label: '',
    successLabel: '',
    title: '',
    iconOnly: false,
    class: '',
  },
)

const { t } = useI18n()
const status = ref<'idle' | 'success' | 'error'>('idle')
const labelText = computed(() => props.label || t('copy'))
const successText = computed(() => props.successLabel || t('copied'))

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

const handleCopy = async () => {
  try {
    const text = await props.getText()
    await writeToClipboard(text)
    status.value = 'success'
  } catch (error) {
    console.error('Failed to copy text', error)
    status.value = 'error'
  } finally {
    window.setTimeout(() => {
      status.value = 'idle'
    }, 1200)
  }
}
</script>

<template>
  <span class="relative inline-flex items-center" :class="props.class">
    <button
      type="button"
      :title="title || labelText"
      :aria-label="title || labelText"
      :class="
        cn(
          'inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
          iconOnly && 'h-8 w-8 justify-center px-0 py-0',
        )
      "
      @click="handleCopy"
    >
      <Check v-if="status === 'success'" :size="14" />
      <Copy v-else :size="14" />
      <span v-if="!iconOnly">{{ status === 'success' ? successText : labelText }}</span>
    </button>

    <span
      v-if="iconOnly && status === 'success'"
      class="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-lg"
      role="status"
      aria-live="polite"
    >
      {{ successText }}
    </span>
  </span>
</template>
