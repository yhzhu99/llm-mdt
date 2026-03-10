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
const showRunConfig = computed(() => props.providerConfigured && props.availableModels.length > 0)

const autosize = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, props.centered ? 360 : 280)}px`
}

watch(input, () => {
  nextTick(() => autosize())
}, { immediate: true })

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
    class="group relative overflow-hidden rounded-[1.65rem] border border-border/80 bg-card/96 shadow-[0_28px_60px_-46px_rgba(15,23,42,0.48)] transition-all duration-300 focus-within:border-primary/35 focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.08)]"
    :class="centered ? 'mx-auto w-full max-w-[72rem]' : 'w-full'"
    @submit.prevent="handleSubmit"
  >
    <div class="relative p-4 sm:p-5">
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="disabled || !providerConfigured"
        :rows="centered ? 6 : 4"
        :placeholder="t('composerPlaceholder')"
        :class="
          centered
            ? 'min-h-[220px] w-full resize-none border-0 bg-transparent text-base leading-8 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70 sm:text-[17px]'
            : 'min-h-[160px] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70'
        "
        @keydown="handleKeydown"
      />

      <div class="mt-3 flex items-end gap-3 border-t border-border/70 pt-3">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <template v-if="showRunConfig">
            <div class="inline-flex flex-wrap gap-1 rounded-full border border-border/70 bg-background/80 p-1">
              <button
                v-for="stage in stageOptions"
                :key="stage.key"
                type="button"
                :disabled="disabled"
                :class="
                  targetStage === stage.key
                    ? 'rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm'
                    : 'rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                "
                @click="emit('update:target-stage', stage.key)"
              >
                {{ stage.label }}
              </button>
            </div>

            <button
              v-for="model in availableModels"
              :key="model"
              type="button"
              :title="model"
              :disabled="disabled || isOnlySelectedModel(model)"
              :class="
                selectedModelSet.has(model)
                  ? 'inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary'
                  : 'inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground'
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
          </template>

          <div
            v-if="isLoading"
            class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
          >
            <LoaderCircle :size="12" class="animate-spin" />
            {{ t('composerGenerating') }}
          </div>
          <div v-else-if="!providerConfigured" class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{{ t('composerProviderHint') }}</span>
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
          class="h-10 w-10 shrink-0 rounded-full shadow-sm"
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
