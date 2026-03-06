<script setup lang="ts">
import Button from '@/components/ui/button/Button.vue'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div class="inline-flex items-center rounded-full border border-border bg-card/80 px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
        Vue 3 + TypeScript + Tailwind migration in progress
      </div>
      <div class="space-y-4">
        <h1 class="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          LLM MDT is being rebuilt on a modern frontend stack.
        </h1>
        <p class="mx-auto max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          The application shell, typed services, and MedX-aligned design system are now in place.
          Next milestones wire the MDT workflow, browser settings, and staged streaming UI.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-3">
        <Button>Foundation ready</Button>
        <Button variant="outline">Tailwind tokens synced</Button>
      </div>
    </div>
  </div>
</template>
