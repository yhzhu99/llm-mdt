<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, KeyRound, Server, Settings2, ShieldAlert, X } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'

interface ProviderSettingsLike {
  baseUrl?: string
  apiKey?: string
  councilModels?: string[] | string
  chairmanModel?: string
  titleModel?: string
  extraHeaders?: Record<string, string>
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

const formatModelList = (models?: string[] | string) =>
  Array.isArray(models) ? models.join('\n') : String(models || '')

const formatHeaderLines = (headers?: Record<string, string>) =>
  Object.entries(headers || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')

const parseHeaderLines = (value: string) =>
  Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) return null
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
      })
      .filter((entry): entry is [string, string] => Boolean(entry?.[0] && entry[1])),
  )

const formState = ref({
  baseUrl: '',
  apiKey: '',
  councilModelsText: '',
  chairmanModel: '',
  titleModel: '',
  extraHeadersText: '',
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
      extraHeadersText: formatHeaderLines(settings?.extraHeaders),
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
    extraHeaders: parseHeaderLines(formState.value.extraHeadersText),
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-soft">
        <div class="flex items-start justify-between gap-4 border-b border-border/80 px-6 py-5">
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-base font-semibold text-foreground">
              <Settings2 :size="18" class="text-primary" />
              Browser provider settings
            </div>
            <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
              Stored only in this browser session. This experience is optimized for local,
              browser-capable providers with permissive CORS.
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
          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div class="flex items-start gap-3">
                <ShieldAlert :size="18" class="mt-0.5 text-amber-600" />
                <div>
                  <div class="text-sm font-semibold text-foreground">Browser-only tradeoff</div>
                  <p class="mt-1 text-sm leading-6 text-muted-foreground">
                    Keep this for personal or local use only. Secrets stored here are visible to
                    anyone with access to this browser profile.
                  </p>
                </div>
              </div>
            </div>
            <div class="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div class="flex items-start gap-3">
                <AlertTriangle :size="18" class="mt-0.5 text-primary" />
                <div>
                  <div class="text-sm font-semibold text-foreground">Direct browser requests</div>
                  <p class="mt-1 text-sm leading-6 text-muted-foreground">
                    The endpoint must accept direct browser-origin requests, or the MDT flow will
                    fail during streaming.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <form class="mt-6 space-y-5" @submit.prevent="handleSubmit">
            <label class="block space-y-2">
              <span class="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <Server :size="16" class="text-primary" />
                OpenAI-compatible base URL
              </span>
              <input
                v-model="formState.baseUrl"
                type="url"
                placeholder="https://openrouter.ai/api/v1/chat/completions"
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label class="block space-y-2">
              <span class="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound :size="16" class="text-primary" />
                API key
              </span>
              <input
                v-model="formState.apiKey"
                type="password"
                placeholder="sk-or-v1-..."
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label class="block space-y-2">
              <span class="text-sm font-medium text-foreground">Council models</span>
              <textarea
                v-model="formState.councilModelsText"
                rows="5"
                placeholder="One model per line"
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div class="text-xs text-muted-foreground">
                {{ councilCount }} model<span v-if="councilCount !== 1">s</span> configured
              </div>
            </label>

            <div class="grid gap-5 md:grid-cols-2">
              <label class="block space-y-2">
                <span class="text-sm font-medium text-foreground">Chairman model</span>
                <input
                  v-model="formState.chairmanModel"
                  type="text"
                  placeholder="google/gemini-3-pro-preview"
                  class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label class="block space-y-2">
                <span class="text-sm font-medium text-foreground">Title model</span>
                <input
                  v-model="formState.titleModel"
                  type="text"
                  placeholder="Defaults to chairman model"
                  class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>

            <label class="block space-y-2">
              <span class="text-sm font-medium text-foreground">Extra headers</span>
              <textarea
                v-model="formState.extraHeadersText"
                rows="4"
                placeholder="HTTP-Referer: https://example.com&#10;X-Title: LLM MDT"
                class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div class="text-xs text-muted-foreground">
                Optional. Use one header per line in <code>Name: Value</code> format.
              </div>
            </label>

            <div
              v-if="error"
              class="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {{ error }}
            </div>
          </form>
        </div>

        <div class="flex flex-col gap-3 border-t border-border/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" @click="emit('clear')">Clear stored settings</Button>
          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" @click="emit('close')">Cancel</Button>
            <Button @click="handleSubmit">Save settings</Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
