<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FolderOpen,
  FolderPlus,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import Button from '@/components/ui/button/Button.vue'
import type { ConversationRunStage, ConversationRunState } from '@/types'
import { cn } from '@/utils'

interface ConversationSummary {
  id: string
  title?: string
  project_id: string
  created_at: string
  message_count?: number
}

interface ProjectSummary {
  id: string
  name: string
  created_at: string
  conversation_count: number
  is_default?: boolean
}

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
  (event: 'toggle-collapsed'): void
}>()

const { t } = useI18n()

const openProjectMenuId = ref<string | null>(null)
const openConversationMenuId = ref<string | null>(null)
const renamingProjectId = ref<string | null>(null)
const renamingConversationId = ref<string | null>(null)
const draftProjectName = ref('')
const draftConversationTitle = ref('')
const isCreatingProject = ref(false)
const draftNewProjectName = ref('')
const newProjectInputRef = ref<HTMLInputElement | null>(null)

const visibleGroups = computed(() => {
  const groupedEntries = Object.entries(props.groupedConversations || {})
    .map(([group, items]) => [group, items] as const)
    .filter(([, items]) => items.length > 0)

  return groupedEntries
})

const defaultProjectNames = new Set(['默认项目', 'Default Project'])
const placeholderConversationTitles = new Set(['', 'New Conversation', 'Conversation', '新对话'])

const displayProjectName = (project: ProjectSummary) => {
  const trimmed = String(project.name || '').trim()
  if (project.is_default && defaultProjectNames.has(trimmed)) {
    return t('projectDefaultName')
  }
  return trimmed || t('projectUntitled')
}

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
  return t('stageStatusComplete')
}

const conversationStatusClass = (conversationId: string) => {
  const state = conversationRunState(conversationId)
  if (!state || state.status === 'idle') return ''
  if (state.status === 'running') return 'border-primary/20 bg-primary/10 text-primary'
  if (state.status === 'error') return 'border-destructive/20 bg-destructive/10 text-destructive'
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
  return 'bg-emerald-500'
}

const conversationButtonTitle = (conversation: ConversationSummary) => {
  const parts = [displayConversationTitle(conversation)]
  const status = conversationStatusLabel(conversation.id)
  if (status) parts.push(status)
  return parts.join(' · ')
}

const startProjectRename = (project: ProjectSummary) => {
  openProjectMenuId.value = null
  renamingProjectId.value = project.id
  draftProjectName.value = displayProjectName(project)
}

const startConversationRename = (conversation: ConversationSummary) => {
  openConversationMenuId.value = null
  renamingConversationId.value = conversation.id
  draftConversationTitle.value = displayConversationTitle(conversation)
}

const submitProjectRename = (projectId: string, fallbackTitle: string) => {
  const title = draftProjectName.value.trim() || fallbackTitle
  renamingProjectId.value = null
  draftProjectName.value = ''
  emit('rename-project', projectId, title)
}

const submitConversationRename = (conversationId: string, fallbackTitle: string) => {
  const title = draftConversationTitle.value.trim() || fallbackTitle
  renamingConversationId.value = null
  draftConversationTitle.value = ''
  emit('rename-conversation', conversationId, title)
}

const projectInitial = (project: ProjectSummary) => displayProjectName(project).slice(0, 1).toUpperCase()

const openProjectCreate = async () => {
  if (props.isCollapsed) {
    emit('toggle-collapsed')
    await nextTick()
  }

  isCreatingProject.value = true
  draftNewProjectName.value = props.suggestedProjectName || ''
  await nextTick()
  newProjectInputRef.value?.focus()
  newProjectInputRef.value?.select()
}

const cancelProjectCreate = () => {
  isCreatingProject.value = false
  draftNewProjectName.value = ''
}

const submitProjectCreate = () => {
  const title = draftNewProjectName.value.trim()
  if (!title) return
  emit('create-project', title)
  cancelProjectCreate()
}
</script>

<template>
  <aside
    :class="
      cn(
        'flex h-screen shrink-0 flex-col border-r border-border/80 bg-card/80 transition-all duration-300',
        isCollapsed ? 'w-[96px]' : 'w-[340px]',
      )
    "
  >
    <div class="border-b border-border/70 px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <MessageSquareText :size="20" />
          </div>
          <div v-if="!isCollapsed" class="min-w-0">
            <div class="truncate text-base font-semibold text-foreground">
              {{ t('appNamePrimary') }}
            </div>
            <div class="truncate text-sm text-muted-foreground">
              {{ t('appNameSecondary') }}
            </div>
          </div>
        </div>

        <Button variant="ghost" size="icon" @click="emit('toggle-collapsed')">
          <ChevronLeft v-if="!isCollapsed" :size="18" />
          <ChevronRight v-else :size="18" />
        </Button>
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <Button class="w-full" @click="openProjectCreate">
          <FolderPlus :size="16" />
          <span v-if="!isCollapsed">{{ t('sidebarNewProject') }}</span>
        </Button>
        <Button class="w-full" variant="secondary" @click="emit('new-conversation')">
          <Plus :size="16" />
          <span v-if="!isCollapsed">{{ t('sidebarNewConversation') }}</span>
        </Button>
      </div>

      <div v-if="isCreatingProject && !isCollapsed" class="mt-3 rounded-2xl border border-border/80 bg-background/90 p-3 shadow-sm">
        <label class="block space-y-2">
          <span class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {{ t('projectCreateName') }}
          </span>
          <input
            ref="newProjectInputRef"
            v-model="draftNewProjectName"
            class="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            :placeholder="t('projectCreatePlaceholder')"
            @keydown.enter.prevent="submitProjectCreate"
            @keydown.esc.prevent="cancelProjectCreate"
          />
        </label>
        <div class="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" @click="cancelProjectCreate">{{ t('settingsCancel') }}</Button>
          <Button size="sm" :disabled="!draftNewProjectName.trim()" @click="submitProjectCreate">
            {{ t('projectCreateConfirm') }}
          </Button>
        </div>
      </div>
    </div>

    <div class="scrollbar-hide flex-1 overflow-y-auto px-3 py-4">
      <div class="space-y-5">
        <section class="space-y-2">
          <div
            v-if="!isCollapsed"
            class="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            {{ t('sidebarProjects') }}
          </div>

          <div v-if="!projects.length" class="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
            {{ t('sidebarNoProjects') }}
          </div>

          <div v-else class="space-y-1">
            <div
              v-for="project in projects"
              :key="project.id"
              :class="
                cn(
                  'group relative rounded-2xl border border-transparent px-3 py-3 transition-colors',
                  currentProjectId === project.id
                    ? 'border-primary/30 bg-primary/10'
                    : 'hover:bg-muted/60',
                )
              "
            >
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-3 text-left"
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

                <div v-if="!isCollapsed" class="min-w-0 flex-1">
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
                v-if="!isCollapsed"
                type="button"
                class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                @click.stop="openProjectMenuId = openProjectMenuId === project.id ? null : project.id"
              >
                <Ellipsis :size="16" />
              </button>

              <div
                v-if="openProjectMenuId === project.id && !isCollapsed"
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
        </section>

        <section class="space-y-2">
          <div
            v-if="!isCollapsed"
            class="flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            <FolderOpen :size="14" />
            {{ t('sidebarConversations') }}
          </div>

          <div v-if="!conversations.length" class="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
            {{ t('sidebarNoConversations') }}
          </div>

          <div v-else class="space-y-5">
            <div v-for="[groupName, items] in visibleGroups" :key="groupName" class="space-y-2">
              <div
                v-if="!isCollapsed"
                class="px-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground"
              >
                {{ groupName }}
              </div>

              <div class="space-y-1">
                <div
                  v-for="conversation in items"
                  :key="conversation.id"
                  :class="
                    cn(
                      'group relative rounded-2xl border border-transparent px-3 py-3 transition-colors',
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
                      class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground"
                    >
                      <MessageSquareText :size="18" />
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
                        @keydown.esc.prevent="renamingConversationId = null"
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
                    class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                    @click.stop="openConversationMenuId = openConversationMenuId === conversation.id ? null : conversation.id"
                  >
                    <Ellipsis :size="16" />
                  </button>

                  <div
                    v-if="openConversationMenuId === conversation.id && !isCollapsed"
                    class="absolute right-3 top-12 z-20 w-40 overflow-hidden rounded-xl border border-border bg-popover shadow-soft"
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
  </aside>
</template>
