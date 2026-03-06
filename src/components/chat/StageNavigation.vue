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
    icon: Sparkles,
    id: props.stageIds.stage1 || '',
    status: props.stageStatus.stage1 || 'waiting',
    enabled: Boolean(props.availableStages.stage1),
  },
  {
    key: 'stage2' as const,
    title: t('stage2Title'),
    icon: Scale,
    id: props.stageIds.stage2 || '',
    status: props.stageStatus.stage2 || 'waiting',
    enabled: Boolean(props.availableStages.stage2),
  },
  {
    key: 'stage3' as const,
    title: t('stage3Title'),
    icon: Crown,
    id: props.stageIds.stage3 || '',
    status: props.stageStatus.stage3 || 'waiting',
    enabled: Boolean(props.availableStages.stage3),
  },
])

const enabledStages = computed(() => stages.value.filter((stage) => stage.enabled && stage.id))

const stageDotClass = (status: StageStatus) =>
  cn(
    'h-2.5 w-2.5 rounded-full bg-muted-foreground/35 transition-colors',
    status === 'running' && 'bg-primary animate-pulse',
    status === 'complete' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
  )

const syncActiveStage = () => {
  if (!enabledStages.value.length) {
    activeStage.value = 'stage1'
    return
  }

  const rootTop = scrollRoot?.getBoundingClientRect().top || 0
  const anchorOffset = 92

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
  if (!stage?.id) return

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
    class="sticky top-3 z-10 flex flex-wrap gap-2 rounded-2xl border border-border/80 bg-background/95 p-2 shadow-sm backdrop-blur"
  >
    <button
      v-for="stage in stages"
      :key="stage.key"
      type="button"
      :disabled="!stage.enabled"
      :class="
        cn(
          'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
          activeStage === stage.key
            ? 'border-primary/35 bg-primary/10 text-primary'
            : 'border-transparent bg-background text-muted-foreground hover:border-border hover:text-foreground',
          !stage.enabled && 'cursor-not-allowed opacity-45 hover:border-transparent hover:text-muted-foreground',
        )
      "
      @click="scrollToStage(stage.key)"
    >
      <component :is="stage.icon" :size="15" />
      <span>{{ stage.title }}</span>
      <span :class="stageDotClass(stage.status)" />
    </button>
  </nav>
</template>
