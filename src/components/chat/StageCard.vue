<script setup lang="ts">
import { cn } from '@/utils'

withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    id?: string
    class?: string
  }>(),
  {
    subtitle: '',
    id: undefined,
    class: '',
  },
)
</script>

<template>
  <section :id="id" :class="cn('overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm', $props.class)">
    <header class="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold tracking-wide text-foreground">{{ title }}</h3>
        <p v-if="subtitle" class="text-sm text-muted-foreground">{{ subtitle }}</p>
      </div>
      <slot name="right" />
    </header>
    <div class="px-5 py-5">
      <slot />
    </div>
  </section>
</template>
