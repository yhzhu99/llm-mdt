<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { COPY_FEEDBACK_DURATION_MS, writeTextToClipboard } from '@/utils/clipboard'
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
const hideTimer = ref<number | null>(null)
const labelText = computed(() => props.label || t('copy'))
const successText = computed(() => props.successLabel || t('copied'))
const errorText = computed(() => t('copyFailed'))
const feedbackText = computed(() =>
  status.value === 'error' ? errorText.value : successText.value,
)

const clearHideTimer = () => {
  if (hideTimer.value !== null) {
    window.clearTimeout(hideTimer.value)
    hideTimer.value = null
  }
}

onBeforeUnmount(() => {
  clearHideTimer()
})

const handleCopy = async () => {
  clearHideTimer()
  try {
    const text = await props.getText()
    await writeTextToClipboard(text)
    status.value = 'success'
  } catch (error) {
    console.error('Failed to copy text', error)
    status.value = 'error'
  } finally {
    hideTimer.value = window.setTimeout(() => {
      status.value = 'idle'
      hideTimer.value = null
    }, COPY_FEEDBACK_DURATION_MS)
  }
}
</script>

<template>
  <span class="copy-feedback-anchor" :class="props.class">
    <button
      type="button"
      :title="title || labelText"
      :aria-label="title || labelText"
      :class="
        cn(
          'copy-trigger',
          iconOnly && 'copy-trigger--icon',
        )
      "
      :data-copy-state="status"
      @click="handleCopy"
    >
      <Check v-if="status === 'success'" :size="14" />
      <Copy v-else :size="14" />
      <span v-if="!iconOnly">{{ labelText }}</span>
    </button>

    <span
      v-if="status !== 'idle'"
      class="copy-feedback-badge"
      data-visible="true"
      :data-state="status"
      role="status"
      aria-live="polite"
    >
      {{ feedbackText }}
    </span>
  </span>
</template>
