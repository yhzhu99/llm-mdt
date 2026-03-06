<script setup lang="ts">
import ChatSurface from '@/components/chat/ChatSurface.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import TopBar from '@/components/layout/TopBar.vue'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import { useMdtApp } from '@/composables/useMdtApp'

const {
  conversations,
  currentConversation,
  currentConversationId,
  draftMessage,
  groupedConversations,
  isLoading,
  isSettingsOpen,
  isSidebarCollapsed,
  providerConfigured,
  providerSettings,
  providerStatus,
  providerStatusText,
  runtimeConfig,
  settingsError,
  clearSettings,
  closeSettings,
  deleteConversation,
  newConversation,
  openSettings,
  renameConversation,
  saveSettings,
  selectConversation,
  sendMessage,
  toggleSidebar,
} = useMdtApp()
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <Sidebar
      :conversations="conversations"
      :grouped-conversations="groupedConversations"
      :current-conversation-id="currentConversationId"
      :is-collapsed="isSidebarCollapsed"
      @delete="deleteConversation"
      @new="newConversation"
      @rename="renameConversation"
      @select="selectConversation"
      @toggle-collapsed="toggleSidebar"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar
        :title="currentConversation?.title || 'LLM MDT'"
        :status="providerStatus"
        :status-text="providerStatusText"
        @new-conversation="newConversation"
        @open-settings="openSettings"
      />

      <ChatSurface
        v-model:draft="draftMessage"
        :conversation="currentConversation"
        :is-loading="isLoading"
        :provider-configured="providerConfigured"
        :runtime-config="runtimeConfig"
        @open-settings="openSettings"
        @send="sendMessage"
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
