<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, LoaderCircle, Settings2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'
import type { MdtTargetStage } from '@/types'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    isLoading?: boolean
    providerConfigured?: boolean
    centered?: boolean
    targetStage?: MdtTargetStage
    selectedModels?: string[]
    availableModels?: string[]
  }>(),
  {
    disabled: false,
    isLoading: false,
    providerConfigured: false,
    centered: false,
    targetStage: 'stage3',
    selectedModels: () => [],
    availableModels: () => [],
  },
)

const emit = defineEmits<{
  (event: 'send', message: string): void
  (event: 'open-settings'): void
  (event: 'update:target-stage', value: MdtTargetStage): void
  (event: 'toggle-model', model: string): void
  (event: 'select-all-models'): void
  (event: 'reset-run-config'): void
}>()

const { t } = useI18n()
const input = defineModel<string>({ default: '' })
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const selectedModelSet = computed(() => new Set(props.selectedModels))
const stageOptions = computed(() => [
  { key: 'stage1' as const, label: t('stage1Title') },
  { key: 'stage2' as const, label: t('stage2Title') },
  { key: 'stage3' as const, label: t('stage3Title') },
])
const canSubmit = computed(
  () =>
    !props.disabled &&
    props.providerConfigured &&
    props.selectedModels.length > 0 &&
    Boolean(input.value.trim()),
)

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
  if (!value || props.selectedModels.length === 0) return

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

const shortModelName = (model: string) => model.split('/')[1] || model
const isOnlySelectedModel = (model: string) =>
  props.selectedModels.length === 1 && selectedModelSet.value.has(model)
</script>

<template>
  <form
    class="group relative overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-soft transition-all duration-300 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.08)]"
    :class="centered ? 'mx-auto w-full max-w-3xl' : 'w-full'"
    @submit.prevent="handleSubmit"
  >
    <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />

    <div class="relative p-5 sm:p-6">
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="disabled || !providerConfigured"
        rows="3"
        :placeholder="t('composerPlaceholder')"
        class="min-h-[148px] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
        @keydown="handleKeydown"
      />

      <div
        v-if="providerConfigured && availableModels.length > 0"
        class="mt-5 space-y-4 rounded-[1.5rem] border border-border/70 bg-background/70 p-4 backdrop-blur"
      >
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-2">
            <div class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {{ t('composerRunToStage') }}
            </div>
            <div class="inline-flex flex-wrap gap-2 rounded-full border border-border/70 bg-card/80 p-1">
              <button
                v-for="stage in stageOptions"
                :key="stage.key"
                type="button"
                :disabled="disabled"
                :class="
                  targetStage === stage.key
                    ? 'rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm'
                    : 'rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                "
                @click="emit('update:target-stage', stage.key)"
              >
                {{ stage.label }}
              </button>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="inline-flex items-center rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-60"
              :disabled="disabled"
              @click="emit('select-all-models')"
            >
              {{ t('composerSelectAllModels') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-60"
              :disabled="disabled"
              @click="emit('reset-run-config')"
            >
              {{ t('composerResetRunConfig') }}
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {{ t('composerEnabledModels', { selected: selectedModels.length, total: availableModels.length }) }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="model in availableModels"
              :key="model"
              type="button"
              :title="model"
              :disabled="disabled || isOnlySelectedModel(model)"
              :class="
                selectedModelSet.has(model)
                  ? 'inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary'
                  : 'inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground'
              "
              @click="emit('toggle-model', model)"
            >
              <span
                :class="
                  selectedModelSet.has(model)
                    ? 'h-2.5 w-2.5 rounded-full bg-primary'
                    : 'h-2.5 w-2.5 rounded-full bg-muted-foreground/35'
                "
              />
              <span>{{ shortModelName(model) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
          <div v-else class="text-xs text-muted-foreground">
            {{ t('composerRunConfigHint') }}
          </div>
        </div>

        <Button
          type="submit"
          size="icon"
          class="h-12 w-12 shrink-0 rounded-2xl"
          :aria-label="t('composerSend')"
          :title="t('composerSend')"
          :disabled="!canSubmit"
          :variant="providerConfigured ? 'default' : 'secondary'"
        >
          <LoaderCircle v-if="isLoading" :size="18" class="animate-spin" />
          <ArrowUp v-else :size="18" />
        </Button>
      </div>
    </div>
  </form>
</template>
