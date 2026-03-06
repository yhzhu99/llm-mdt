<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { cn } from '@/utils'

const props = withDefaults(
  defineProps<{
    isOpen: boolean
    dialogLabel: string
    panelClass?: string
    overlayClass?: string
    closeOnBackdrop?: boolean
  }>(),
  {
    panelClass: '',
    overlayClass: '',
    closeOnBackdrop: true,
  },
)

const emit = defineEmits<{
  (event: 'close'): void
}>()

const dialogRef = ref<HTMLElement | null>(null)
let previousFocusedElement: HTMLElement | null = null

const getFocusableElements = () => {
  const dialog = dialogRef.value
  if (!dialog) return [] as HTMLElement[]

  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'))
}

const focusFirstElement = () => {
  const focusable = getFocusableElements()
  focusable[0]?.focus()
  if (!focusable.length) {
    dialogRef.value?.focus()
  }
}

const close = () => emit('close')

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.isOpen) return

  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key !== 'Tab') return

  const focusable = getFocusableElements()
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeElement = document.activeElement as HTMLElement | null

  if (event.shiftKey && activeElement === first) {
    event.preventDefault()
    last?.focus()
    return
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (typeof document === 'undefined') return

    if (isOpen) {
      previousFocusedElement = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      await nextTick()
      focusFirstElement()
      return
    }

    document.body.style.overflow = ''
    previousFocusedElement?.focus?.()
    previousFocusedElement = null
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      :class="
        cn(
          'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md',
          overlayClass,
        )
      "
      @click.self="closeOnBackdrop && close()"
      @keydown.capture="handleKeydown"
    >
      <div
        ref="dialogRef"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-label="dialogLabel"
        :class="
          cn(
            'flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-border/80 bg-card shadow-soft',
            panelClass,
          )
        "
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
