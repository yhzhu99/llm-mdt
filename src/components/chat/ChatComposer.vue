<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ArrowUp, LoaderCircle, Settings2 } from 'lucide-vue-next'
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
    class="group relative overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-soft transition-all duration-300 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.08)]"
    :class="centered ? 'mx-auto w-full max-w-3xl' : 'w-full'"
    @submit.prevent="handleSubmit"
  >
    <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />

    <div class="relative p-5 pb-20 sm:p-6 sm:pb-20">
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="disabled || !providerConfigured"
        rows="3"
        :placeholder="t('composerPlaceholder')"
        class="min-h-[148px] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
        @keydown="handleKeydown"
      />

      <div class="absolute inset-x-5 bottom-5 flex flex-col gap-3 sm:inset-x-6 sm:flex-row sm:items-end sm:justify-between">
        <div class="space-y-2 text-xs text-muted-foreground">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-md border border-border bg-background/90 px-1.5 py-0.5 font-medium text-foreground">Enter</span>
            <span>{{ t('composerEnterSend') }}</span>
            <span>·</span>
            <span class="rounded-md border border-border bg-background/90 px-1.5 py-0.5 font-medium text-foreground">Shift</span>
            <span>+</span>
            <span class="rounded-md border border-border bg-background/90 px-1.5 py-0.5 font-medium text-foreground">Enter</span>
            <span>{{ t('composerNewline') }}</span>
          </div>
          <div v-if="isLoading" class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            <LoaderCircle :size="12" class="animate-spin" />
            {{ t('composerGenerating') }}
          </div>
          <div v-else-if="!providerConfigured" class="flex flex-wrap items-center gap-2">
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
          class="h-12 w-12 shrink-0 rounded-2xl"
          :aria-label="t('composerSend')"
          :title="t('composerSend')"
          :disabled="disabled || !providerConfigured || !input.trim()"
          :variant="providerConfigured ? 'default' : 'secondary'"
        >
          <LoaderCircle v-if="isLoading" :size="18" class="animate-spin" />
          <ArrowUp v-else :size="18" />
        </Button>
      </div>
    </div>
  </form>
</template>
