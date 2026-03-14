<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crown, MessageSquareText, Scale, Sparkles, Square } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { cn } from '@/utils'

type StageKey = 'stage1' | 'stage2' | 'stage3'
type StageStatus = 'waiting' | 'running' | 'complete' | 'error'
type NavigationSectionKey = 'question' | StageKey

const props = withDefaults(
  defineProps<{
    questionId?: string
    questionEnabled?: boolean
    stageIds?: Partial<Record<StageKey, string>>
    stageStatus?: Partial<Record<StageKey, StageStatus>>
    availableStages?: Partial<Record<StageKey, boolean>>
    scrollRootId?: string
    showStopButton?: boolean
  }>(),
  {
    questionId: '',
    questionEnabled: false,
    stageIds: () => ({}),
    stageStatus: () => ({}),
    availableStages: () => ({}),
    scrollRootId: '',
    showStopButton: false,
  },
)

const emit = defineEmits<{
  (event: 'stop'): void
}>()

const { t } = useI18n()
const navRef = ref<HTMLElement | null>(null)
const activeSection = ref<NavigationSectionKey>('question')
let scrollRoot: HTMLElement | null = null
let animationFrameId = 0

const sections = computed(() => [
  {
    key: 'question' as const,
    title: t('conversationQuestionLabel'),
    subtitle: t('conversationQuestionNavSubtitle'),
    icon: MessageSquareText,
    id: props.questionId || '',
    status: 'complete' as const,
    enabled: Boolean(props.questionEnabled && props.questionId),
    badge: 'Q',
    showStatusDot: false,
  },
  {
    key: 'stage1' as const,
    title: t('stage1Title'),
    subtitle: t('stage1Subtitle'),
    icon: Sparkles,
    id: props.stageIds.stage1 || '',
    status: props.stageStatus.stage1 || 'waiting',
    enabled: Boolean(props.availableStages.stage1),
    badge: '01',
    showStatusDot: true,
  },
  {
    key: 'stage2' as const,
    title: t('stage2Title'),
    subtitle: t('stage2Subtitle'),
    icon: Scale,
    id: props.stageIds.stage2 || '',
    status: props.stageStatus.stage2 || 'waiting',
    enabled: Boolean(props.availableStages.stage2),
    badge: '02',
    showStatusDot: true,
  },
  {
    key: 'stage3' as const,
    title: t('stage3Title'),
    subtitle: t('stage3Subtitle'),
    icon: Crown,
    id: props.stageIds.stage3 || '',
    status: props.stageStatus.stage3 || 'waiting',
    enabled: Boolean(props.availableStages.stage3),
    badge: '03',
    showStatusDot: true,
  },
])

const enabledSections = computed(() => sections.value.filter((section) => section.enabled && section.id))

const stageDotClass = (status: StageStatus) =>
  cn(
    'h-2.5 w-2.5 rounded-full bg-muted-foreground/30 transition-colors',
    status === 'running' && 'bg-primary animate-pulse',
    status === 'complete' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
  )

const sectionCardClass = (sectionKey: NavigationSectionKey, enabled: boolean) =>
  cn(
    'group relative flex min-w-[9.5rem] items-start gap-3 rounded-[1.2rem] border px-3 py-2.5 text-left transition-all lg:min-w-0 lg:w-full',
    activeSection.value === sectionKey
      ? 'border-primary/25 bg-primary/10 text-foreground shadow-[0_12px_28px_-24px_rgba(37,99,235,0.58)]'
      : 'border-border/65 bg-background/75 text-muted-foreground hover:border-border hover:bg-background hover:text-foreground',
    !enabled &&
      'cursor-not-allowed border-dashed border-border/60 bg-background/50 text-muted-foreground/75 opacity-80 hover:border-border/60 hover:bg-background/50 hover:text-muted-foreground/75',
  )

const resolveScrollRoot = () =>
  scrollRoot ||
  (props.scrollRootId
    ? (document.getElementById(props.scrollRootId) as HTMLElement | null)
    : ((navRef.value?.closest('[data-chat-scroll-root]') as HTMLElement | null) ?? null))

const syncActiveSection = () => {
  if (!enabledSections.value.length) {
    activeSection.value = 'question'
    return
  }

  const root = resolveScrollRoot()
  if (!root) {
    activeSection.value = enabledSections.value[0]?.key || 'question'
    return
  }

  const rootTop = root.getBoundingClientRect().top
  const anchorOffset = 96
  const nearest = enabledSections.value
    .map((section) => {
      const element = document.getElementById(section.id)
      if (!element) return null

      return {
        key: section.key,
        distance: Math.abs(element.getBoundingClientRect().top - rootTop - anchorOffset),
      }
    })
    .filter((entry): entry is { key: NavigationSectionKey; distance: number } => Boolean(entry))
    .sort((left, right) => left.distance - right.distance)[0]

  activeSection.value = nearest?.key || enabledSections.value[0]?.key || 'question'
}

const requestSyncActiveSection = () => {
  if (animationFrameId) return
  animationFrameId = window.requestAnimationFrame(() => {
    animationFrameId = 0
    syncActiveSection()
  })
}

const unbindScrollSpy = () => {
  if (scrollRoot) {
    scrollRoot.removeEventListener('scroll', requestSyncActiveSection)
  }
  scrollRoot = null
  window.removeEventListener('resize', requestSyncActiveSection)

  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
  }
}

const bindScrollSpy = async () => {
  await nextTick()
  unbindScrollSpy()

  scrollRoot = resolveScrollRoot()
  if (!scrollRoot) {
    activeSection.value = enabledSections.value[0]?.key || 'question'
    return
  }

  activeSection.value = enabledSections.value[0]?.key || 'question'
  scrollRoot.addEventListener('scroll', requestSyncActiveSection, { passive: true })
  window.addEventListener('resize', requestSyncActiveSection, { passive: true })
  requestSyncActiveSection()
}

const scrollToSection = (sectionKey: NavigationSectionKey) => {
  const section = sections.value.find((item) => item.key === sectionKey)
  if (!section?.id || !section.enabled) return

  const target = document.getElementById(section.id)
  if (!target) return

  activeSection.value = section.key

  const root = resolveScrollRoot()
  if (!root) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }

  const anchorOffset = 96
  const nextTop = root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - anchorOffset
  root.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' })
}

watch(
  () =>
    `${props.scrollRootId}::${sections.value
      .map((section) => `${section.key}:${section.id}:${section.status}:${section.enabled ? '1' : '0'}`)
      .join('|')}`,
  () => {
    void bindScrollSpy()
  },
  { immediate: true },
)

onMounted(() => {
  void bindScrollSpy()
})

onBeforeUnmount(() => {
  unbindScrollSpy()
})
</script>

<template>
  <nav
    ref="navRef"
    class="sticky top-5 rounded-[1.35rem] border border-border/70 bg-background/72 p-2.5 shadow-[0_20px_48px_-40px_rgba(15,23,42,0.38)] backdrop-blur"
  >
    <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-hide lg:flex-col lg:gap-2.5 lg:overflow-visible lg:pb-0">
      <button
        v-for="section in sections"
        :key="section.key"
        type="button"
        :disabled="!section.enabled"
        :class="sectionCardClass(section.key, section.enabled)"
        @click="scrollToSection(section.key)"
      >
        <span
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/10 bg-background/75 text-current"
        >
          <component :is="section.icon" :size="15" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {{ section.badge }}
          </span>
          <span class="mt-1 block text-sm font-semibold text-current">{{ section.title }}</span>
          <span class="mt-0.5 hidden text-[11px] leading-5 text-muted-foreground lg:block lg:line-clamp-2">
            {{ section.subtitle }}
          </span>
        </span>
        <span
          v-if="section.showStatusDot"
          :class="stageDotClass(section.status)"
        />
        <span v-else class="h-2.5 w-2.5 shrink-0 rounded-full opacity-0" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="props.showStopButton"
      class="mt-2 border-t border-border/70 pt-2"
    >
      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-2 rounded-[1rem] border border-rose-500/20 bg-rose-500/10 px-3 py-2.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-500/15"
        @click="emit('stop')"
      >
        <Square :size="14" />
        {{ t('conversationStop') }}
      </button>
    </div>
  </nav>
</template>
