<script setup lang="ts">
import { Languages, Plus, Settings2 } from 'lucide-vue-next'
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
  <header class="sticky top-0 z-20 border-b border-border/80 bg-background/80 backdrop-blur-xl">
    <div class="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div class="flex min-w-0 items-center gap-3">
        <div
          :class="
            cn(
              'flex h-9 w-9 items-center justify-center rounded-[1rem] bg-card/30 p-0.5',
              status === 'running' && 'ring-2 ring-primary/20',
              status === 'ready' && 'ring-2 ring-emerald-500/20',
              status === 'error' && 'ring-2 ring-destructive/20',
            )
          "
        >
          <img src="/logo.svg" alt="" class="h-8 w-8 rounded-[0.9rem] shadow-sm" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-foreground">{{ title || t('appNamePrimary') }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span
              :class="
                cn(
                  'h-2 w-2 rounded-full bg-muted-foreground/35',
                  status === 'running' && 'animate-pulse bg-primary',
                  status === 'ready' && 'bg-emerald-500',
                  status === 'error' && 'bg-destructive',
                )
              "
            />
            <span class="truncate">{{ statusText || status }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <div class="hidden items-center gap-1 rounded-full border border-border/80 bg-card/80 p-1 sm:flex">
          <span class="inline-flex items-center gap-1 px-2 text-[11px] font-medium text-muted-foreground">
            <Languages :size="14" />
            {{ t('topBarLanguage') }}
          </span>
          <button
            type="button"
            class="rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors"
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
            class="rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors"
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

        <Button variant="ghost" size="sm" class="h-9 rounded-xl px-3" @click="$emit('open-settings')">
          <Settings2 :size="16" />
          <span class="hidden sm:inline">{{ t('topBarSettings') }}</span>
        </Button>
        <Button size="sm" class="h-9 rounded-xl px-3.5" @click="$emit('new-conversation')">
          <Plus :size="16" />
          <span class="hidden sm:inline">{{ t('topBarNewChat') }}</span>
        </Button>
      </div>
    </div>
  </header>
</template>
