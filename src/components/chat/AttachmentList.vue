<script setup lang="ts">
import { computed } from 'vue'
import { FileText, X } from 'lucide-vue-next'
import type { UserAttachment } from '@/types'
import Button from '@/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    attachments?: UserAttachment[]
    removable?: boolean
    disabled?: boolean
  }>(),
  {
    attachments: () => [],
    removable: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  (event: 'remove', attachmentId: string): void
}>()

const imageAttachments = computed(() => props.attachments.filter((attachment) => attachment.kind === 'image'))
const fileAttachments = computed(() => props.attachments.filter((attachment) => attachment.kind !== 'image'))

const formatSize = (size: number) => {
  if (!size || size < 1024) return `${size || 0} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div v-if="attachments.length" class="space-y-3">
    <div v-if="imageAttachments.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="attachment in imageAttachments"
        :key="attachment.id"
        class="group relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/70"
      >
        <img
          :src="attachment.dataUrl"
          :alt="attachment.name"
          class="h-40 w-full object-cover"
        />
        <div class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent px-3 py-3 text-xs text-white">
          <div class="min-w-0">
            <div class="truncate font-medium">{{ attachment.name }}</div>
            <div class="opacity-80">{{ formatSize(attachment.size) }}</div>
          </div>
          <Button
            v-if="removable"
            type="button"
            size="icon"
            variant="ghost"
            class="h-8 w-8 shrink-0 rounded-full bg-white/12 text-white hover:bg-white/18"
            :disabled="disabled"
            @click="emit('remove', attachment.id)"
          >
            <X :size="14" />
          </Button>
        </div>
      </div>
    </div>

    <div v-if="fileAttachments.length" class="flex flex-wrap gap-2">
      <div
        v-for="attachment in fileAttachments"
        :key="attachment.id"
        class="inline-flex max-w-full items-center gap-3 rounded-full border border-border/70 bg-background/80 px-3 py-2 text-sm text-foreground"
      >
        <div class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <FileText :size="16" />
        </div>
        <div class="min-w-0">
          <div class="truncate font-medium">{{ attachment.name }}</div>
          <div class="text-xs text-muted-foreground">{{ formatSize(attachment.size) }}</div>
        </div>
        <Button
          v-if="removable"
          type="button"
          size="icon"
          variant="ghost"
          class="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          :disabled="disabled"
          @click="emit('remove', attachment.id)"
        >
          <X :size="14" />
        </Button>
      </div>
    </div>
  </div>
</template>
