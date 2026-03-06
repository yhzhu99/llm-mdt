<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderPlus, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'
import ModalShell from '@/components/common/ModalShell.vue'

const props = withDefaults(
  defineProps<{
    isOpen: boolean
    suggestedName?: string
  }>(),
  {
    suggestedName: '',
  },
)

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'create', title: string): void
}>()

const { t } = useI18n()
const draftName = ref('')

watch(
  () => [props.isOpen, props.suggestedName] as const,
  ([isOpen, suggestedName]) => {
    if (!isOpen) return
    draftName.value = String(suggestedName || '').trim()
  },
  { immediate: true },
)

const isDisabled = computed(() => !draftName.value.trim())

const handleSubmit = () => {
  const title = draftName.value.trim()
  if (!title) return
  emit('create', title)
}
</script>

<template>
  <ModalShell :is-open="isOpen" :dialog-label="t('projectCreateTitle')" panel-class="max-w-xl" @close="emit('close')">
    <div class="flex items-start justify-between gap-4 border-b border-border/80 bg-background/60 px-6 py-5 backdrop-blur">
      <div class="space-y-2">
        <div class="flex items-center gap-2 text-base font-semibold text-foreground">
          <FolderPlus :size="18" class="text-primary" />
          {{ t('projectCreateTitle') }}
        </div>
        <p class="max-w-xl text-sm leading-6 text-muted-foreground">
          {{ t('projectCreateDescription') }}
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

    <form class="space-y-5 px-6 py-6" @submit.prevent="handleSubmit">
      <label class="block space-y-2">
        <span class="text-sm font-medium text-foreground">{{ t('projectCreateName') }}</span>
        <input
          v-model="draftName"
          class="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none ring-offset-background transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          :placeholder="t('projectCreatePlaceholder')"
        />
      </label>
    </form>

    <div class="flex items-center justify-end gap-2 border-t border-border/80 px-6 py-5">
      <Button variant="ghost" @click="emit('close')">{{ t('settingsCancel') }}</Button>
      <Button :disabled="isDisabled" @click="handleSubmit">{{ t('projectCreateConfirm') }}</Button>
    </div>
  </ModalShell>
</template>
