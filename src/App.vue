<script setup lang="ts">
import { computed } from 'vue'
import ChatSurface from '@/components/chat/ChatSurface.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import TopBar from '@/components/layout/TopBar.vue'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import { useMdtApp } from '@/composables/useMdtApp'

const {
  conversations,
  conversationRunStates,
  currentConversation,
  currentConversationCanRetryRecovery,
  currentConversationId,
  currentConversationRecoveryError,
  currentConversationRecovering,
  currentConversationRunState,
  currentConversationRunning,
  currentChatRunPreferences,
  currentProjectId,
  draftMessage,
  groupedConversations,
  goHome,
  isSettingsOpen,
  isSidebarCollapsed,
  projects,
  providerConfigured,
  providerSettings,
  providerStatus,
  providerStatusText,
  runtimeConfig,
  suggestedProjectName,
  createProject,
  settingsError,
  clearSettings,
  closeSettings,
  deleteConversation,
  deleteProject,
  newConversation,
  openSettings,
  renameConversation,
  renameProject,
  retryConversationRecovery,
  rerunConversation,
  saveSettings,
  selectConversation,
  selectProject,
  sendMessage,
  setLocale,
  setChatTargetStage,
  stopConversation,
  toggleChatCouncilModel,
  t,
  toggleSidebar,
} = useMdtApp()

const placeholderConversationTitles = new Set(['', 'New Conversation', 'Conversation', '新对话'])
const topBarTitle = computed(() => {
  const title = String(currentConversation.value?.title || '').trim()
  return placeholderConversationTitles.has(title) ? t('appNamePrimary') : title
})
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <Sidebar
      :projects="projects"
      :conversations="conversations"
      :conversation-run-states="conversationRunStates"
      :grouped-conversations="groupedConversations"
      :current-conversation-id="currentConversationId"
      :current-project-id="currentProjectId"
      :suggested-project-name="suggestedProjectName"
      :is-collapsed="isSidebarCollapsed"
      @create-project="createProject"
      @delete-conversation="deleteConversation"
      @delete-project="deleteProject"
      @go-home="goHome"
      @new-conversation="newConversation"
      @rename-conversation="renameConversation"
      @rename-project="renameProject"
      @select-conversation="selectConversation"
      @select-project="selectProject"
      @toggle-collapsed="toggleSidebar"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar
        :title="topBarTitle"
        :status="providerStatus"
        :status-text="providerStatusText"
        @change-locale="setLocale"
        @open-settings="openSettings"
      />

      <ChatSurface
        v-model:draft="draftMessage"
        :chat-run-preferences="currentChatRunPreferences"
        :conversation="currentConversation"
        :can-retry-recovery="currentConversationCanRetryRecovery"
        :is-loading="currentConversationRunning"
        :is-recovering="currentConversationRecovering"
        :recovery-error="currentConversationRecoveryError"
        :provider-configured="providerConfigured"
        :run-status="currentConversationRunState.status"
        :runtime-config="runtimeConfig"
        @new-conversation="newConversation"
        @open-settings="openSettings"
        @rerun="rerunConversation"
        @retry-recovery="retryConversationRecovery"
        @send="sendMessage"
        @stop="stopConversation"
        @toggle-model="toggleChatCouncilModel"
        @update-target-stage="setChatTargetStage"
      />
    </div>

    <SettingsModal
      :is-open="isSettingsOpen"
      :settings="providerSettings"
      :error="settingsError"
      @clear="clearSettings"
      @close="closeSettings"
      @save="saveSettings"
    />
  </div>
</template>
