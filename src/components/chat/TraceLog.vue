<script setup lang="ts">
import { computed, ref } from 'vue'
import { Binary, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import CopyButton from '@/components/common/CopyButton.vue'

const props = defineProps<{
  metadata?: unknown
}>()

const { t } = useI18n()
const open = ref(false)
const serialized = computed(() => {
  try {
    return JSON.stringify(props.metadata ?? null, null, 2)
  } catch {
    return String(props.metadata)
  }
})
</script>

<template>
  <div v-if="props.metadata" class="rounded-2xl border border-border/80 bg-background">
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        @click="open = !open"
      >
        <Binary :size="16" class="text-primary" />
        {{ open ? t('traceHide') : t('traceShow') }}
        <ChevronUp v-if="open" :size="16" />
        <ChevronDown v-else :size="16" />
      </button>
      <CopyButton icon-only :title="t('copyTraceLog')" :get-text="() => serialized" />
    </div>
    <pre
      v-if="open"
      class="overflow-x-auto border-t border-border/70 bg-muted/40 px-4 py-4 text-xs leading-6 text-muted-foreground"
    ><code>{{ serialized }}</code></pre>
  </div>
</template>
