<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { KeyRound, Server, Settings2, ShieldAlert, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'

interface ProviderSettingsLike {
  baseUrl?: string
  apiKey?: string
  councilModels?: string[] | string
  chairmanModel?: string
  titleModel?: string
}

const props = defineProps<{
  isOpen: boolean
  settings?: ProviderSettingsLike | null
  error?: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', value: ProviderSettingsLike): void
  (event: 'clear'): void
}>()

const { t } = useI18n()
const dialogRef = ref<HTMLElement | null>(null)
const firstFieldRef = ref<HTMLInputElement | null>(null)
let previousFocusedElement: HTMLElement | null = null

const formatModelList = (models?: string[] | string) =>
  Array.isArray(models) ? models.join('\n') : String(models || '')

const formState = ref({
  baseUrl: '',
  apiKey: '',
  councilModelsText: '',
  chairmanModel: '',
  titleModel: '',
})

watch(
  () => [props.isOpen, props.settings] as const,
  ([isOpen, settings]) => {
    if (!isOpen) return
    formState.value = {
      baseUrl: settings?.baseUrl || '',
      apiKey: settings?.apiKey || '',
      councilModelsText: formatModelList(settings?.councilModels),
      chairmanModel: settings?.chairmanModel || '',
      titleModel: settings?.titleModel || settings?.chairmanModel || '',
    }
  },
  { immediate: true, deep: true },
)

const councilCount = computed(
  () =>
    formState.value.councilModelsText
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean).length,
)

const handleSubmit = () => {
  emit('save', {
    baseUrl: formState.value.baseUrl,
    apiKey: formState.value.apiKey,
    councilModels: formState.value.councilModelsText,
    chairmanModel: formState.value.chairmanModel,
    titleModel: formState.value.titleModel,
  })
}

const getFocusableElements = () => {
  const dialog = dialogRef.value
  if (!dialog) return [] as HTMLElement[]

  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'))
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.isOpen) return

  if (event.key === 'Escape') {
    event.preventDefault()
    return
  }

  if (event.key !== 'Tab') return

  const focusable = getFocusableElements()
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeElement = document.activeElement as HTMLElement | null

  if (event.shiftKey && activeElement === first) {
    event.preventDefault()
    last?.focus()
    return
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (typeof document === 'undefined') return

    if (isOpen) {
      previousFocusedElement = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      await nextTick()
      firstFieldRef.value?.focus()
      return
    }

    document.body.style.overflow = ''
    previousFocusedElement?.focus?.()
    previousFocusedElement = null
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md"
      @click.prevent
      @keydown.capture="handleKeydown"
      @mousedown.self.prevent
    >
      <div
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settingsTitle')"
        class="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-border/80 bg-card shadow-soft"
      >
        <div class="flex items-start justify-between gap-4 border-b border-border/80 bg-background/60 px-6 py-5 backdrop-blur">
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-base font-semibold text-foreground">
              <Settings2 :size="18" class="text-primary" />
              {{ t('settingsTitle') }}
            </div>
            <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
              {{ t('settingsDescription') }}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </div>

        <div class="scrollbar-hide flex-1 overflow-y-auto px-6 py-6">
          <div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div class="flex items-start gap-3">
              <ShieldAlert :size="18" class="mt-0.5 text-amber-600" />
              <div>
                <div class="text-sm font-semibold text-foreground">{{ t('settingsTradeoffTitle') }}</div>
                <p class="mt-1 text-sm leading-6 text-muted-foreground">
                  {{ t('settingsTradeoffBody') }}
                </p>
              </div>
            </div>
          </div>

          <form class="mt-6 space-y-5" @submit.prevent="handleSubmit">
            <label class="block space-y-2">
              <span class="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <Server :size="16" class="text-primary" />
                {{ t('settingsBaseUrl') }}
              </span>
              <input
                ref="firstFieldRef"
                v-model="formState.baseUrl"
                type="url"
                placeholder="https://openrouter.ai/api/v1/chat/completions"
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label class="block space-y-2">
              <span class="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound :size="16" class="text-primary" />
                {{ t('settingsApiKey') }}
              </span>
              <input
                v-model="formState.apiKey"
                type="password"
                placeholder="sk-or-v1-..."
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label class="block space-y-2">
              <span class="text-sm font-medium text-foreground">{{ t('settingsCouncilModels') }}</span>
              <textarea
                v-model="formState.councilModelsText"
                rows="5"
                :placeholder="t('settingsModelPerLine')"
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div class="text-xs text-muted-foreground">
                {{ t('settingsModelsConfigured', { count: councilCount }) }}
              </div>
            </label>

            <div class="grid gap-5 md:grid-cols-2">
              <label class="block space-y-2">
                <span class="text-sm font-medium text-foreground">{{ t('settingsChairmanModel') }}</span>
                <input
                  v-model="formState.chairmanModel"
                  type="text"
                  placeholder="google/gemini-3-pro-preview"
                  class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label class="block space-y-2">
                <span class="text-sm font-medium text-foreground">{{ t('settingsTitleModel') }}</span>
                <input
                  v-model="formState.titleModel"
                  type="text"
                  :placeholder="t('settingsTitleModelPlaceholder')"
                  class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div class="text-xs text-muted-foreground">
                  {{ t('settingsTitleModelHelp') }}
                </div>
              </label>
            </div>

            <div
              v-if="error"
              class="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {{ error }}
            </div>
          </form>
        </div>

        <div class="flex flex-col gap-3 border-t border-border/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" @click="emit('clear')">{{ t('settingsClear') }}</Button>
          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" @click="emit('close')">{{ t('settingsCancel') }}</Button>
            <Button @click="handleSubmit">{{ t('settingsSave') }}</Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
