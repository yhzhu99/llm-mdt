<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { cn } from '@/utils'

interface ConversationSummary {
  id: string
  title?: string
  created_at: string
  message_count?: number
}

const props = withDefaults(
  defineProps<{
    conversations: ConversationSummary[]
    groupedConversations?: Record<string, ConversationSummary[]>
    currentConversationId?: string | null
    isCollapsed?: boolean
  }>(),
  {
    groupedConversations: () => ({}),
    currentConversationId: null,
    isCollapsed: false,
  },
)

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'new'): void
  (event: 'delete', id: string): void
  (event: 'rename', id: string, title: string): void
  (event: 'toggle-collapsed'): void
}>()

const openMenuId = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const draftTitle = ref('')

const visibleGroups = computed(() => {
  const groupedEntries = Object.entries(props.groupedConversations || {})
    .map(([group, items]) => [
      group,
      items.filter((conversation) => (conversation.message_count ?? 0) > 0),
    ] as const)
    .filter(([, items]) => items.length > 0)

  if (groupedEntries.length > 0) return groupedEntries

  return [
    [
      'Recent',
      props.conversations.filter((conversation) => (conversation.message_count ?? 0) > 0),
    ] as const,
  ]
})

const startRename = (conversation: ConversationSummary) => {
  openMenuId.value = null
  renamingId.value = conversation.id
  draftTitle.value = conversation.title || 'Conversation'
}

const submitRename = (conversationId: string, fallbackTitle: string) => {
  const title = draftTitle.value.trim() || fallbackTitle
  renamingId.value = null
  draftTitle.value = ''
  emit('rename', conversationId, title)
}
</script>

<template>
  <aside
    :class="
      cn(
        'flex h-screen shrink-0 flex-col border-r border-border/80 bg-card/80 transition-all duration-300',
        isCollapsed ? 'w-[88px]' : 'w-[320px]',
      )
    "
  >
    <div class="border-b border-border/70 px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <button
          type="button"
          class="flex min-w-0 items-center gap-3 text-left"
          @click="emit('new')"
        >
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <MessageSquareText :size="20" />
          </div>
          <div v-if="!isCollapsed" class="min-w-0">
            <div class="truncate text-sm font-semibold tracking-[0.18em] text-muted-foreground">
              LLM MDT
            </div>
            <div class="truncate text-base font-semibold text-foreground">
              Browser council
            </div>
          </div>
        </button>

        <Button variant="ghost" size="icon" @click="emit('toggle-collapsed')">
          <ChevronLeft v-if="!isCollapsed" :size="18" />
          <ChevronRight v-else :size="18" />
        </Button>
      </div>

      <Button class="mt-4 w-full" @click="emit('new')">
        <Plus :size="16" />
        <span v-if="!isCollapsed">New conversation</span>
      </Button>
    </div>

    <div class="scrollbar-hide flex-1 overflow-y-auto px-3 py-4">
      <div v-if="!conversations.length" class="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
        No conversations yet
      </div>

      <div v-else class="space-y-5">
        <div v-for="[groupName, items] in visibleGroups" :key="groupName" class="space-y-2">
          <div
            v-if="!isCollapsed"
            class="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
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
                @click="emit('select', conversation.id)"
              >
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground"
                >
                  <MessageSquareText :size="18" />
                </div>

                <div v-if="!isCollapsed" class="min-w-0 flex-1">
                  <input
                    v-if="renamingId === conversation.id"
                    v-model="draftTitle"
                    class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    @blur="submitRename(conversation.id, conversation.title || 'Conversation')"
                    @keydown.enter.prevent="submitRename(conversation.id, conversation.title || 'Conversation')"
                    @keydown.esc.prevent="renamingId = null"
                  />
                  <template v-else>
                    <div class="truncate text-sm font-medium text-foreground">
                      {{ conversation.title || 'Conversation' }}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">
                      {{ conversation.message_count || 0 }} message<span v-if="(conversation.message_count || 0) !== 1">s</span>
                    </div>
                  </template>
                </div>
              </button>

              <button
                v-if="!isCollapsed"
                type="button"
                class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                @click.stop="openMenuId = openMenuId === conversation.id ? null : conversation.id"
              >
                <Ellipsis :size="16" />
              </button>

              <div
                v-if="openMenuId === conversation.id && !isCollapsed"
                class="absolute right-3 top-12 z-20 w-40 overflow-hidden rounded-xl border border-border bg-popover shadow-soft"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  @click.stop="startRename(conversation)"
                >
                  <Pencil :size="14" />
                  Rename
                </button>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  @click.stop="openMenuId = null; emit('delete', conversation.id)"
                >
                  <Trash2 :size="14" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
