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
    :class="cn('rounded-[1.65rem] border border-border/70 bg-card/85 p-5 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.42)] backdrop-blur', $props.class)"
  >
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold tracking-wide text-foreground">{{ title }}</h3>
        <p v-if="subtitle" class="text-sm leading-6 text-muted-foreground">{{ subtitle }}</p>
      </div>
      <slot name="right" />
    </header>
    <div class="mt-5">
      <slot />
    </div>
  </section>
</template>
