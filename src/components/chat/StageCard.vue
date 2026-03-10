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
  <section
    :id="id"
    :class="cn('rounded-[1.45rem] border border-border/70 bg-card/80 p-4 shadow-[0_20px_48px_-40px_rgba(15,23,42,0.36)] backdrop-blur sm:p-5', $props.class)"
  >
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 class="text-sm font-semibold tracking-[0.01em] text-foreground">{{ title }}</h3>
        <p v-if="subtitle" class="text-sm leading-6 text-muted-foreground">{{ subtitle }}</p>
      </div>
      <slot name="right" />
    </header>
    <div class="mt-4">
      <slot />
    </div>
  </section>
</template>
