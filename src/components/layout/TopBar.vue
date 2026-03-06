<script setup lang="ts">
import { Activity, Languages, Plus, Settings2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { AppLocale } from '@/types'
import Button from '@/components/ui/button/Button.vue'
import { cn } from '@/utils'

withDefaults(
  defineProps<{
    title?: string
    status?: 'ready' | 'running' | 'error' | 'unconfigured'
    statusText?: string
  }>(),
  {
    title: '',
    status: 'unconfigured',
    statusText: '',
  },
)

const emit = defineEmits<{
  (event: 'new-conversation'): void
  (event: 'open-settings'): void
  (event: 'change-locale', value: AppLocale): void
}>()

const { locale, t } = useI18n()
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur">
    <div class="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <div
          :class="
            cn(
              'flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40',
              status === 'running' && 'bg-primary/10 text-primary',
              status === 'ready' && 'bg-emerald-500/10 text-emerald-600',
              status === 'error' && 'bg-destructive/10 text-destructive',
            )
          "
        >
          <Activity :size="18" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-base font-semibold text-foreground">{{ title || t('appNamePrimary') }}</div>
          <div class="truncate text-sm text-muted-foreground">
            {{ statusText || status }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div class="hidden items-center gap-1 rounded-xl border border-border/80 bg-card/80 p-1 sm:flex">
          <span class="inline-flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
            <Languages :size="14" />
            {{ t('topBarLanguage') }}
          </span>
          <button
            type="button"
            class="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            :class="
              locale === 'zh-CN'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            "
            @click="emit('change-locale', 'zh-CN')"
          >
            {{ t('localeZh') }}
          </button>
          <button
            type="button"
            class="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            :class="
              locale === 'en'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            "
            @click="emit('change-locale', 'en')"
          >
            {{ t('localeEn') }}
          </button>
        </div>

        <Button variant="ghost" size="sm" @click="$emit('open-settings')">
          <Settings2 :size="16" />
          <span class="hidden sm:inline">{{ t('topBarSettings') }}</span>
        </Button>
        <Button size="sm" @click="$emit('new-conversation')">
          <Plus :size="16" />
          <span class="hidden sm:inline">{{ t('topBarNewChat') }}</span>
        </Button>
      </div>
    </div>
  </header>
</template>
