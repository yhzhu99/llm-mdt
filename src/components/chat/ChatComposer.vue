<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ArrowUp, Settings2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    isLoading?: boolean
    providerConfigured?: boolean
    centered?: boolean
  }>(),
  {
    disabled: false,
    isLoading: false,
    providerConfigured: false,
    centered: false,
  },
)

const emit = defineEmits<{
  (event: 'send', message: string): void
  (event: 'open-settings'): void
}>()

const { t } = useI18n()
const input = defineModel<string>({ default: '' })
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const autosize = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 280)}px`
}

watch(input, () => {
  nextTick(() => autosize())
})

const handleSubmit = async () => {
  if (props.disabled || !props.providerConfigured) return
  const value = input.value.trim()
  if (!value) return

  emit('send', value)
  input.value = ''
  await nextTick()
  textareaRef.value?.focus()
  autosize()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void handleSubmit()
  }
}
</script>

<template>
  <form
    class="rounded-[1.75rem] border border-border/80 bg-card shadow-soft"
    :class="centered ? 'w-full max-w-3xl' : ''"
    @submit.prevent="handleSubmit"
  >
    <div class="p-4">
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="disabled || !providerConfigured"
        rows="3"
        :placeholder="t('composerPlaceholder')"
        class="min-h-[92px] w-full resize-none border-0 bg-transparent text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
        @keydown="handleKeydown"
      />
    </div>

    <div class="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="space-y-1 text-xs text-muted-foreground">
        <div class="flex items-center gap-2">
          <span class="rounded-md border border-border bg-background px-1.5 py-0.5 font-medium text-foreground">Enter</span>
          <span>{{ t('composerEnterSend') }}</span>
          <span>·</span>
          <span class="rounded-md border border-border bg-background px-1.5 py-0.5 font-medium text-foreground">Shift</span>
          <span>+</span>
          <span class="rounded-md border border-border bg-background px-1.5 py-0.5 font-medium text-foreground">Enter</span>
          <span>{{ t('composerNewline') }}</span>
        </div>
        <div v-if="isLoading">{{ t('composerGenerating') }}</div>
        <div v-else-if="!providerConfigured" class="flex items-center gap-2">
          {{ t('composerProviderHint') }}
          <button
            type="button"
            class="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
            @click="emit('open-settings')"
          >
            <Settings2 :size="14" />
            {{ t('openSettings') }}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        size="icon"
        :aria-label="t('composerSend')"
        :title="t('composerSend')"
        :disabled="disabled || !providerConfigured || !input.trim()"
        :variant="providerConfigured ? 'default' : 'secondary'"
      >
        <ArrowUp :size="16" />
      </Button>
    </div>
  </form>
</template>
