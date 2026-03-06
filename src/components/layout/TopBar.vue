<script setup lang="ts">
import { Activity, Plus, Settings2 } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { cn } from '@/utils'

withDefaults(
  defineProps<{
    title?: string
    status?: 'ready' | 'running' | 'error' | 'unconfigured'
    statusText?: string
  }>(),
  {
    title: 'LLM MDT',
    status: 'unconfigured',
    statusText: '',
  },
)

defineEmits<{
  (event: 'new-conversation'): void
  (event: 'open-settings'): void
}>()
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
          <div class="truncate text-base font-semibold text-foreground">{{ title }}</div>
          <div class="truncate text-sm text-muted-foreground">
            {{ statusText || status }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" @click="$emit('open-settings')">
          <Settings2 :size="16" />
          <span class="hidden sm:inline">Settings</span>
        </Button>
        <Button size="sm" @click="$emit('new-conversation')">
          <Plus :size="16" />
          <span class="hidden sm:inline">New chat</span>
        </Button>
      </div>
    </div>
  </header>
</template>
