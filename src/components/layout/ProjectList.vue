<script setup lang="ts">
import { ref, watch } from 'vue'
import { Ellipsis, Pencil, Trash2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { ProjectSummary } from '@/types'
import { cn } from '@/utils'

const props = withDefaults(
  defineProps<{
    projects: ProjectSummary[]
    currentProjectId?: string | null
    collapsed?: boolean
  }>(),
  {
    currentProjectId: null,
    collapsed: false,
  },
)

const emit = defineEmits<{
  (event: 'select-project', id: string): void
  (event: 'delete-project', id: string): void
  (event: 'rename-project', id: string, title: string): void
}>()

const { t } = useI18n()
const openProjectMenuId = ref<string | null>(null)
const renamingProjectId = ref<string | null>(null)
const draftProjectName = ref('')

const defaultProjectNames = new Set(['默认项目', 'Default Project'])

const displayProjectName = (project: ProjectSummary) => {
  const trimmed = String(project.name || '').trim()
  if (project.is_default && defaultProjectNames.has(trimmed)) {
    return t('projectDefaultName')
  }
  return trimmed || t('projectUntitled')
}

const projectInitial = (project: ProjectSummary) => displayProjectName(project).slice(0, 1).toUpperCase()

const startProjectRename = (project: ProjectSummary) => {
  openProjectMenuId.value = null
  renamingProjectId.value = project.id
  draftProjectName.value = displayProjectName(project)
}

const submitProjectRename = (projectId: string, fallbackTitle: string) => {
  const title = draftProjectName.value.trim() || fallbackTitle
  renamingProjectId.value = null
  draftProjectName.value = ''
  emit('rename-project', projectId, title)
}

watch(
  () => props.collapsed,
  (collapsed) => {
    if (!collapsed) return
    openProjectMenuId.value = null
    renamingProjectId.value = null
    draftProjectName.value = ''
  },
)

watch(
  () => props.projects,
  (projects) => {
    if (openProjectMenuId.value && !projects.some((project) => project.id === openProjectMenuId.value)) {
      openProjectMenuId.value = null
    }
    if (renamingProjectId.value && !projects.some((project) => project.id === renamingProjectId.value)) {
      renamingProjectId.value = null
      draftProjectName.value = ''
    }
  },
  { deep: true },
)
</script>

<template>
  <div class="space-y-1">
    <div
      v-for="project in projects"
      :key="project.id"
      :class="
        cn(
          'group relative rounded-2xl border border-transparent px-3 py-3 transition-colors',
          currentProjectId === project.id ? 'border-primary/30 bg-primary/10' : 'hover:bg-muted/60',
        )
      "
    >
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-3 text-left"
        :title="collapsed ? displayProjectName(project) : undefined"
        @click="emit('select-project', project.id)"
      >
        <div
          :class="
            cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-sm font-semibold text-muted-foreground',
              currentProjectId === project.id && 'text-primary',
            )
          "
        >
          {{ projectInitial(project) }}
        </div>

        <div v-if="!collapsed" class="min-w-0 flex-1">
          <input
            v-if="renamingProjectId === project.id"
            v-model="draftProjectName"
            class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            @blur="submitProjectRename(project.id, displayProjectName(project))"
            @keydown.enter.prevent="submitProjectRename(project.id, displayProjectName(project))"
            @keydown.esc.prevent="renamingProjectId = null"
          />
          <template v-else>
            <div class="truncate text-sm font-medium text-foreground">
              {{ displayProjectName(project) }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ t('sidebarProjectCount', { count: project.conversation_count || 0 }) }}
            </div>
          </template>
        </div>
      </button>

      <button
        v-if="!collapsed"
        type="button"
        class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
        @click.stop="openProjectMenuId = openProjectMenuId === project.id ? null : project.id"
      >
        <Ellipsis :size="16" />
      </button>

      <div
        v-if="openProjectMenuId === project.id && !collapsed"
        class="absolute right-3 top-12 z-20 w-40 overflow-hidden rounded-xl border border-border bg-popover shadow-soft"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          @click.stop="startProjectRename(project)"
        >
          <Pencil :size="14" />
          {{ t('sidebarRename') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
          @click.stop="openProjectMenuId = null; emit('delete-project', project.id)"
        >
          <Trash2 :size="14" />
          {{ t('sidebarDelete') }}
        </button>
      </div>
    </div>
  </div>
</template>
