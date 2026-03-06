<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crown, Scale, Sparkles } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { cn } from '@/utils'

type StageKey = 'stage1' | 'stage2' | 'stage3'
type StageStatus = 'waiting' | 'running' | 'complete' | 'error'

const props = withDefaults(
  defineProps<{
    stageIds?: Partial<Record<StageKey, string>>
    stageStatus?: Partial<Record<StageKey, StageStatus>>
    availableStages?: Partial<Record<StageKey, boolean>>
  }>(),
  {
    stageIds: () => ({}),
    stageStatus: () => ({}),
    availableStages: () => ({}),
  },
)

const { t } = useI18n()
const navRef = ref<HTMLElement | null>(null)
const activeStage = ref<StageKey>('stage1')
let scrollRoot: HTMLElement | null = null
let animationFrameId = 0

const stages = computed(() => [
  {
    key: 'stage1' as const,
    title: t('stage1Title'),
    subtitle: t('stage1Subtitle'),
    icon: Sparkles,
    id: props.stageIds.stage1 || '',
    status: props.stageStatus.stage1 || 'waiting',
    enabled: Boolean(props.availableStages.stage1),
  },
  {
    key: 'stage2' as const,
    title: t('stage2Title'),
    subtitle: t('stage2Subtitle'),
    icon: Scale,
    id: props.stageIds.stage2 || '',
    status: props.stageStatus.stage2 || 'waiting',
    enabled: Boolean(props.availableStages.stage2),
  },
  {
    key: 'stage3' as const,
    title: t('stage3Title'),
    subtitle: t('stage3Subtitle'),
    icon: Crown,
    id: props.stageIds.stage3 || '',
    status: props.stageStatus.stage3 || 'waiting',
    enabled: Boolean(props.availableStages.stage3),
  },
])

const enabledStages = computed(() => stages.value.filter((stage) => stage.enabled && stage.id))

const stageDotClass = (status: StageStatus) =>
  cn(
    'h-2.5 w-2.5 rounded-full bg-muted-foreground/30 transition-colors',
    status === 'running' && 'bg-primary animate-pulse',
    status === 'complete' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
  )

const stageCardClass = (stageKey: StageKey, enabled: boolean) =>
  cn(
    'group relative flex min-w-[11.5rem] items-start gap-3 rounded-[1.35rem] border px-4 py-3 text-left transition-all lg:min-w-0 lg:w-full',
    activeStage.value === stageKey
      ? 'border-primary/25 bg-primary/10 text-foreground shadow-[0_12px_32px_-24px_rgba(37,99,235,0.6)]'
      : 'border-border/65 bg-background/75 text-muted-foreground hover:border-border hover:bg-background hover:text-foreground',
    !enabled &&
      'cursor-not-allowed border-dashed border-border/60 bg-background/50 text-muted-foreground/75 opacity-80 hover:border-border/60 hover:bg-background/50 hover:text-muted-foreground/75',
  )

const syncActiveStage = () => {
  if (!enabledStages.value.length) {
    activeStage.value = 'stage1'
    return
  }

  const rootTop = scrollRoot?.getBoundingClientRect().top || 0
  const anchorOffset = window.innerWidth >= 1024 ? 84 : 120

  const nearest = enabledStages.value
    .map((stage) => {
      const element = document.getElementById(stage.id)
      if (!element) return null

      return {
        key: stage.key,
        distance: Math.abs(element.getBoundingClientRect().top - rootTop - anchorOffset),
      }
    })
    .filter((entry): entry is { key: StageKey; distance: number } => Boolean(entry))
    .sort((left, right) => left.distance - right.distance)[0]

  activeStage.value = nearest?.key || enabledStages.value[0]?.key || 'stage1'
}

const requestSyncActiveStage = () => {
  if (animationFrameId) return
  animationFrameId = window.requestAnimationFrame(() => {
    animationFrameId = 0
    syncActiveStage()
  })
}

const unbindScrollSpy = () => {
  if (scrollRoot) {
    scrollRoot.removeEventListener('scroll', requestSyncActiveStage)
  }
  scrollRoot = null
  window.removeEventListener('resize', requestSyncActiveStage)

  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
  }
}

const bindScrollSpy = async () => {
  await nextTick()
  unbindScrollSpy()

  scrollRoot = navRef.value?.closest('[data-chat-scroll-root]') as HTMLElement | null
  if (!scrollRoot) {
    activeStage.value = enabledStages.value[0]?.key || 'stage1'
    return
  }

  activeStage.value = enabledStages.value[0]?.key || 'stage1'
  scrollRoot.addEventListener('scroll', requestSyncActiveStage, { passive: true })
  window.addEventListener('resize', requestSyncActiveStage, { passive: true })
  requestSyncActiveStage()
}

const scrollToStage = (stageKey: StageKey) => {
  const stage = stages.value.find((item) => item.key === stageKey)
  if (!stage?.id || !stage.enabled) return

  const target = document.getElementById(stage.id)
  if (!target) return

  activeStage.value = stage.key
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(
  () =>
    stages.value
      .map((stage) => `${stage.key}:${stage.id}:${stage.status}:${stage.enabled ? '1' : '0'}`)
      .join('|'),
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
    class="sticky top-6 rounded-[1.6rem] border border-border/70 bg-background/70 p-3 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.42)] backdrop-blur"
  >
    <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-hide lg:flex-col lg:gap-3 lg:overflow-visible lg:pb-0">
      <button
        v-for="(stage, index) in stages"
        :key="stage.key"
        type="button"
        :disabled="!stage.enabled"
        :class="stageCardClass(stage.key, stage.enabled)"
        @click="scrollToStage(stage.key)"
      >
        <span
          class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-current/10 bg-background/75 text-current"
        >
          <component :is="stage.icon" :size="16" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            0{{ index + 1 }}
          </span>
          <span class="mt-1 block text-sm font-semibold text-current">{{ stage.title }}</span>
          <span class="mt-1 block text-xs leading-5 text-muted-foreground lg:line-clamp-2">{{ stage.subtitle }}</span>
        </span>
        <span :class="stageDotClass(stage.status)" />
      </button>
    </div>
  </nav>
</template>
