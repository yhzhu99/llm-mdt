<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FolderPlus,
  FolderOpen,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'
import ModalShell from '@/components/common/ModalShell.vue'
import ProjectCreateDialog from '@/components/layout/ProjectCreateDialog.vue'
import ProjectList from '@/components/layout/ProjectList.vue'
import type { ConversationRunStage, ConversationRunState, ConversationSummary, ProjectSummary } from '@/types'
import { cn } from '@/utils'

const props = withDefaults(
  defineProps<{
    projects: ProjectSummary[]
    conversations: ConversationSummary[]
    conversationRunStates?: Record<string, ConversationRunState>
    groupedConversations?: Record<string, ConversationSummary[]>
    currentConversationId?: string | null
    currentProjectId?: string | null
    suggestedProjectName?: string
    isCollapsed?: boolean
  }>(),
  {
    conversationRunStates: () => ({}),
    groupedConversations: () => ({}),
    currentConversationId: null,
    currentProjectId: null,
    suggestedProjectName: '',
    isCollapsed: false,
  },
)

const emit = defineEmits<{
  (event: 'select-conversation', id: string): void
  (event: 'new-conversation'): void
  (event: 'delete-conversation', id: string): void
  (event: 'rename-conversation', id: string, title: string): void
  (event: 'select-project', id: string): void
  (event: 'create-project', title: string): void
  (event: 'delete-project', id: string): void
  (event: 'rename-project', id: string, title: string): void
  (event: 'go-home'): void
  (event: 'toggle-collapsed'): void
}>()

const { t } = useI18n()

const openConversationMenuId = ref<string | null>(null)
const renamingConversationId = ref<string | null>(null)
const draftConversationTitle = ref('')
const isProjectCreateOpen = ref(false)
const isProjectBrowserOpen = ref(false)
const visibleProjectLimit = 5

const visibleGroups = computed(() => {
  const groupedEntries = Object.entries(props.groupedConversations || {})
    .map(([group, items]) => [group, items] as const)
    .filter(([, items]) => items.length > 0)

  return groupedEntries
})

const placeholderConversationTitles = new Set(['', 'New Conversation', 'Conversation', '新对话'])

const displayConversationTitle = (conversation: ConversationSummary) => {
  const trimmed = String(conversation.title || '').trim()
  return placeholderConversationTitles.has(trimmed) ? t('conversationUntitled') : trimmed
}

const conversationRunState = (conversationId: string) => props.conversationRunStates?.[conversationId] || null

const stageLabel = (stage: ConversationRunStage) => {
  if (stage === 'stage1') return t('stage1Title')
  if (stage === 'stage2') return t('stage2Title')
  if (stage === 'stage3') return t('stage3Title')
  return ''
}

const conversationStatusLabel = (conversationId: string) => {
  const state = conversationRunState(conversationId)
  if (!state || state.status === 'idle') return ''
  if (state.isRecovering) return t('statusRecoveringShort')
  if (state.status === 'running') {
    const currentStage = stageLabel(state.stage)
    return currentStage ? `${currentStage} · ${t('stageStatusLive')}` : t('stageStatusLive')
  }
  if (state.status === 'error') return t('stageStatusError')
  if (state.status === 'stopped') return t('stageStatusStopped')
  return t('stageStatusComplete')
}

const conversationStatusClass = (conversationId: string) => {
  const state = conversationRunState(conversationId)
  if (!state || state.status === 'idle') return ''
  if (state.status === 'running') return 'border-primary/20 bg-primary/10 text-primary'
  if (state.status === 'error') return 'border-destructive/20 bg-destructive/10 text-destructive'
  if (state.status === 'stopped') return 'border-amber-500/20 bg-amber-500/10 text-amber-700'
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
}

const showCollapsedConversationDot = (conversationId: string) => {
  if (!props.isCollapsed) return false
  const state = conversationRunState(conversationId)
  return Boolean(state && (state.status !== 'idle' || state.hasUnreadUpdate))
}

const conversationStatusDotClass = (conversationId: string) => {
  const state = conversationRunState(conversationId)
  if (!state || state.status === 'idle') {
    return state?.hasUnreadUpdate ? 'bg-primary' : ''
  }
  if (state.status === 'running') return 'bg-primary animate-pulse'
  if (state.status === 'error') return 'bg-destructive'
  if (state.status === 'stopped') return 'bg-amber-500'
  return 'bg-emerald-500'
}

const conversationButtonTitle = (conversation: ConversationSummary) => {
  const parts = [displayConversationTitle(conversation)]
  const status = conversationStatusLabel(conversation.id)
  if (status) parts.push(status)
  return parts.join(' · ')
}

const visibleProjects = computed(() => {
  if (props.projects.length <= visibleProjectLimit) {
    return props.projects
  }

  const leadingProjects = props.projects.slice(0, visibleProjectLimit)
  const currentProject = props.projects.find((project) => project.id === props.currentProjectId)

  if (!currentProject || leadingProjects.some((project) => project.id === currentProject.id)) {
    return leadingProjects
  }

  return [...props.projects.slice(0, visibleProjectLimit - 1), currentProject]
})

const hiddenProjects = computed(() => {
  const visibleIds = new Set(visibleProjects.value.map((project) => project.id))
  return props.projects.filter((project) => !visibleIds.has(project.id))
})

const hasHiddenProjects = computed(() => hiddenProjects.value.length > 0)

const showMoreProjectsLabel = computed(() =>
  t('sidebarShowMoreProjects', {
    count: hiddenProjects.value.length,
  }),
)

const openProjectCreate = () => {
  isProjectCreateOpen.value = true
}

const startConversationRename = (conversation: ConversationSummary) => {
  openConversationMenuId.value = null
  renamingConversationId.value = conversation.id
  draftConversationTitle.value = displayConversationTitle(conversation)
}

const submitConversationRename = (conversationId: string, fallbackTitle: string) => {
  if (renamingConversationId.value !== conversationId) return
  const title = draftConversationTitle.value.trim() || fallbackTitle
  renamingConversationId.value = null
  draftConversationTitle.value = ''
  emit('rename-conversation', conversationId, title)
}

const closeProjectCreate = () => {
  isProjectCreateOpen.value = false
}

const handleProjectCreate = (title: string) => {
  emit('create-project', title)
  closeProjectCreate()
}

const handleProjectSelect = (projectId: string) => {
  emit('select-project', projectId)
  isProjectBrowserOpen.value = false
}

const handleProjectRename = (projectId: string, title: string) => {
  emit('rename-project', projectId, title)
}
</script>

<template>
  <aside
    :class="
      cn(
        'flex h-screen shrink-0 flex-col border-r border-border/80 bg-card/75 backdrop-blur transition-all duration-300',
        isCollapsed ? 'w-[84px]' : 'w-[320px]',
      )
    "
  >
    <div :class="cn('border-b border-border/70 py-3', isCollapsed ? 'px-2.5' : 'px-3.5')">
      <div :class="cn('flex gap-3', isCollapsed ? 'flex-col items-center' : 'items-center justify-between')">
        <button
          type="button"
          :title="t('sidebarBackHome')"
          :class="
            cn(
              'group flex min-w-0 items-center text-left transition-transform',
              isCollapsed ? 'w-10 justify-center' : 'flex-1 gap-3',
            )
          "
          @click="emit('go-home')"
        >
          <img src="/logo.svg" alt="" class="h-10 w-10 shrink-0 rounded-2xl shadow-sm transition-transform group-hover:scale-[1.02]" />
          <div v-if="!isCollapsed" class="min-w-0">
            <div class="truncate text-sm font-semibold text-foreground">
              {{ t('appNamePrimary') }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ t('appNameSecondary') }}
            </div>
          </div>
        </button>

        <Button variant="ghost" size="icon" class="h-9 w-9 shrink-0 rounded-xl" @click="emit('toggle-collapsed')">
          <ChevronLeft v-if="!isCollapsed" :size="18" />
          <ChevronRight v-else :size="18" />
        </Button>
      </div>

      <div
        class="mt-3 grid gap-2"
        :class="isCollapsed ? 'grid-cols-1' : 'grid-cols-2'"
      >
        <Button
          size="sm"
          :class="cn('w-full h-9 rounded-xl', isCollapsed ? 'justify-center px-0' : 'justify-center px-3')"
          :title="isCollapsed ? t('sidebarNewProject') : undefined"
          @click="openProjectCreate"
        >
          <FolderPlus :size="16" />
          <span v-if="!isCollapsed">{{ t('sidebarNewProject') }}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :class="cn('w-full h-9 rounded-xl', isCollapsed ? 'justify-center px-0' : 'justify-center px-3')"
          :title="isCollapsed ? t('sidebarNewConversation') : undefined"
          @click="emit('new-conversation')"
        >
          <Plus :size="16" />
          <span v-if="!isCollapsed">{{ t('sidebarNewConversation') }}</span>
        </Button>
      </div>
    </div>

    <div class="scrollbar-hide flex-1 overflow-y-auto px-2.5 py-3">
      <div class="space-y-4">
        <section class="space-y-2">
          <div
            v-if="!isCollapsed"
            class="px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
          >
            {{ t('sidebarProjects') }}
          </div>

          <div v-if="!projects.length" class="rounded-[1.1rem] border border-dashed border-border bg-background/70 px-4 py-5 text-center text-sm text-muted-foreground">
            {{ t('sidebarNoProjects') }}
          </div>

          <template v-else>
            <ProjectList
              :projects="visibleProjects"
              :current-project-id="currentProjectId"
              :collapsed="isCollapsed"
              @delete-project="emit('delete-project', $event)"
              @rename-project="handleProjectRename"
              @select-project="handleProjectSelect"
            />

            <button
              v-if="hasHiddenProjects"
              type="button"
              :title="isCollapsed ? showMoreProjectsLabel : undefined"
              :class="
                cn(
                  'group flex w-full items-center rounded-[1.1rem] border border-dashed border-border/80 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5',
                  isCollapsed ? 'justify-center' : 'gap-3',
                )
              "
              @click="isProjectBrowserOpen = true"
            >
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
                <Ellipsis :size="16" />
              </div>
              <div v-if="!isCollapsed" class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-foreground">
                  {{ showMoreProjectsLabel }}
                </div>
                <div class="truncate text-[11px] text-muted-foreground">
                  {{ t('sidebarAllProjectsDescription') }}
                </div>
              </div>
            </button>
          </template>
        </section>

        <section class="space-y-2">
          <div
            v-if="!isCollapsed"
            class="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
          >
            <FolderOpen :size="14" />
            {{ t('sidebarConversations') }}
          </div>

          <div v-if="!conversations.length" class="rounded-[1.1rem] border border-dashed border-border bg-background/70 px-4 py-5 text-center text-sm text-muted-foreground">
            {{ t('sidebarNoConversations') }}
          </div>

          <div v-else class="space-y-4">
            <div v-for="[groupName, items] in visibleGroups" :key="groupName" class="space-y-2">
              <div
                v-if="!isCollapsed"
                class="px-2 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground"
              >
                {{ groupName }}
              </div>

              <div class="space-y-1">
                <div
                  v-for="conversation in items"
                  :key="conversation.id"
                  :class="
                    cn(
                      'group relative rounded-[1.1rem] border border-transparent px-2.5 py-2.5 transition-colors',
                      currentConversationId === conversation.id
                        ? 'border-primary/30 bg-primary/10'
                        : 'hover:bg-muted/60',
                    )
                  "
                >
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-3 text-left"
                    :title="isCollapsed ? conversationButtonTitle(conversation) : undefined"
                    @click="emit('select-conversation', conversation.id)"
                  >
                    <div
                      class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground"
                    >
                      <MessageSquareText :size="16" />
                      <span
                        v-if="showCollapsedConversationDot(conversation.id)"
                        :class="
                          cn(
                            'absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background',
                            conversationStatusDotClass(conversation.id),
                            conversationRunState(conversation.id)?.hasUnreadUpdate && 'ring-2 ring-primary/20',
                          )
                        "
                      />
                    </div>

                    <div v-if="!isCollapsed" class="min-w-0 flex-1">
                      <input
                        v-if="renamingConversationId === conversation.id"
                        v-model="draftConversationTitle"
                        class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                        @blur="submitConversationRename(conversation.id, displayConversationTitle(conversation))"
                        @keydown.enter.prevent="submitConversationRename(conversation.id, displayConversationTitle(conversation))"
                        @keydown.esc.prevent="renamingConversationId = null; draftConversationTitle = ''"
                      />
                      <template v-else>
                        <div class="flex items-center gap-2">
                          <div class="truncate text-sm font-medium text-foreground">
                            {{ displayConversationTitle(conversation) }}
                          </div>
                          <span
                            v-if="conversationRunState(conversation.id)?.hasUnreadUpdate"
                            class="h-2 w-2 shrink-0 rounded-full bg-primary"
                          />
                        </div>
                        <div
                          v-if="conversationStatusLabel(conversation.id)"
                          class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                          <span
                            :class="
                              cn(
                                'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
                                conversationStatusClass(conversation.id),
                              )
                            "
                          >
                            {{ conversationStatusLabel(conversation.id) }}
                          </span>
                        </div>
                      </template>
                    </div>
                  </button>

                  <button
                    v-if="!isCollapsed"
                    type="button"
                    class="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                    @click.stop="openConversationMenuId = openConversationMenuId === conversation.id ? null : conversation.id"
                  >
                    <Ellipsis :size="14" />
                  </button>

                  <div
                    v-if="openConversationMenuId === conversation.id && !isCollapsed"
                    class="absolute right-2.5 top-10 z-20 w-36 overflow-hidden rounded-xl border border-border bg-popover shadow-soft"
                  >
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      @click.stop="startConversationRename(conversation)"
                    >
                      <Pencil :size="14" />
                      {{ t('sidebarRename') }}
                    </button>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                      @click.stop="openConversationMenuId = null; emit('delete-conversation', conversation.id)"
                    >
                      <Trash2 :size="14" />
                      {{ t('sidebarDelete') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ProjectCreateDialog
      :is-open="isProjectCreateOpen"
      :suggested-name="suggestedProjectName"
      @close="closeProjectCreate"
      @create="handleProjectCreate"
    />

    <ModalShell
      :is-open="isProjectBrowserOpen"
      :dialog-label="t('sidebarAllProjects')"
      panel-class="max-w-2xl"
      @close="isProjectBrowserOpen = false"
    >
      <div class="flex items-start justify-between gap-4 border-b border-border/80 bg-background/60 px-5 py-4 backdrop-blur">
        <div class="space-y-1.5">
          <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Ellipsis :size="18" class="text-primary" />
            {{ t('sidebarAllProjects') }}
          </div>
          <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
            {{ t('sidebarAllProjectsDescription') }}
          </p>
        </div>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="isProjectBrowserOpen = false"
        >
          <X :size="18" />
        </button>
      </div>

      <div class="scrollbar-hide flex-1 overflow-y-auto px-5 py-5">
        <ProjectList
          :projects="projects"
          :current-project-id="currentProjectId"
          @delete-project="emit('delete-project', $event)"
          @rename-project="handleProjectRename"
          @select-project="handleProjectSelect"
        />
      </div>
    </ModalShell>
  </aside>
</template>
