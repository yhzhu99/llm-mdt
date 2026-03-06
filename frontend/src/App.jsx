import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import TopBar from './components/TopBar';
import SettingsDialog from './components/SettingsDialog';
import { api } from './api';
import './App.css';

const groupConversationsByDate = (conversations) => {
  const groups = {};
  const sorted = [...(conversations || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const toDateKey = (iso) => {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  };

  const dateKeys = [];
  const seen = new Set();
  for (const conversation of sorted) {
    const key = toDateKey(conversation.created_at);
    if (!seen.has(key)) {
      seen.add(key);
      dateKeys.push(key);
    }
  }

  for (const key of dateKeys) groups[key] = [];
  for (const conversation of sorted) {
    const key = toDateKey(conversation.created_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(conversation);
  }

  return groups;
};

function getRuntimeConfig(settings) {
  return {
    configured: Boolean(
      settings?.baseUrl &&
        settings?.apiKey &&
        settings?.chairmanModel &&
        Array.isArray(settings?.councilModels) &&
        settings.councilModels.length > 0
    ),
    council_models: settings?.councilModels || [],
    chairman_model: settings?.chairmanModel || '',
    title_model: settings?.titleModel || settings?.chairmanModel || '',
    base_url: settings?.baseUrl || '',
  };
}

function getProviderHost(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

function getProviderStatusText(status, settings, errorMessage) {
  if (status === 'running') return 'Running MDT locally';
  if (status === 'error') return errorMessage || 'Provider error';
  if (status === 'ready') {
    const host = getProviderHost(settings?.baseUrl);
    return host ? `Ready · ${host}` : 'Ready';
  }
  return 'Configure local provider';
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingAfterStream, setIsRefreshingAfterStream] = useState(false);
  const [draftConversationId, setDraftConversationId] = useState(null);
  const [providerSettings, setProviderSettings] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [lastProviderError, setLastProviderError] = useState('');
  const [isSidebarCollapsed] = useState(false);

  const runtimeConfig = useMemo(
    () => getRuntimeConfig(providerSettings),
    [providerSettings]
  );
  const providerConfigured = runtimeConfig.configured;
  const providerStatus = isLoading
    ? 'running'
    : lastProviderError
      ? 'error'
      : providerConfigured
        ? 'ready'
        : 'unconfigured';
  const providerStatusText = getProviderStatusText(
    providerStatus,
    providerSettings,
    lastProviderError
  );

  const loadConversations = async () => {
    try {
      const nextConversations = await api.listConversations();
      setConversations(nextConversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadProviderSettings = async () => {
    try {
      const settings = await api.getProviderSettings();
      setProviderSettings(settings);
    } catch (error) {
      console.error('Failed to load provider settings:', error);
      setLastProviderError('Failed to load local settings');
    }
  };

  const loadConversation = useCallback(async (id) => {
    try {
      const conversation = await api.getConversation(id);
      setCurrentConversation(conversation);
    } catch (error) {
      console.error('Failed to load conversation:', error);
      if (currentConversationId === id) {
        setCurrentConversation(null);
      }
    }
  }, [currentConversationId]);

  const upsertConversationInSidebar = (conversation) => {
    if (!conversation?.id) return;
    setConversations((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const index = list.findIndex((entry) => entry?.id === conversation.id);
      const next = [...list];
      if (index === -1) {
        next.unshift(conversation);
      } else {
        next[index] = { ...next[index], ...conversation };
      }
      next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return next;
    });
  };

  useEffect(() => {
    loadConversations();
    loadProviderSettings();
  }, []);

  useEffect(() => {
    if (currentConversationId && !isLoading && !isRefreshingAfterStream) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId, isLoading, isRefreshingAfterStream, loadConversation]);

  const handleOpenSettings = () => {
    setSettingsError('');
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = async (nextSettings) => {
    try {
      const saved = await api.saveProviderSettings(nextSettings);
      setProviderSettings(saved);
      setSettingsError('');
      setLastProviderError('');
      setIsSettingsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
      throw error;
    }
  };

  const handleClearSettings = async () => {
    try {
      const cleared = await api.clearProviderSettings();
      setProviderSettings(cleared);
      setSettingsError('');
      setLastProviderError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
    }
  };

  const handleNewConversation = () => {
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setDraftConversationId(null);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      if (currentConversationId === id) {
        handleNewConversation();
      }
      await loadConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (id, title) => {
    try {
      await api.renameConversation(id, title);
      await loadConversations();
      if (currentConversationId === id) {
        await loadConversation(id);
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const ensureConversationForSend = async () => {
    if (currentConversationId) return currentConversationId;

    if (draftConversationId) {
      setCurrentConversationId(draftConversationId);
      return draftConversationId;
    }

    const newConversation = await api.createConversation();
    setDraftConversationId(newConversation.id);
    setCurrentConversationId(newConversation.id);
    return newConversation.id;
  };

  const handleSendMessage = async (content) => {
    if (!providerConfigured) {
      setLastProviderError('Configure a browser-capable provider before sending a message.');
      handleOpenSettings();
      return;
    }

    let conversationIdForRequest;

    try {
      conversationIdForRequest = await ensureConversationForSend();
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return;
    }

    setLastProviderError('');
    setIsLoading(true);
    setIsRefreshingAfterStream(false);

    try {
      setCurrentConversation((prev) => {
        if (prev) return prev;
        return {
          id: conversationIdForRequest,
          created_at: new Date().toISOString(),
          title: 'New Conversation',
          messages: [],
        };
      });

      const optimisticCreatedAt = currentConversation?.created_at || new Date().toISOString();
      upsertConversationInSidebar({
        id: conversationIdForRequest,
        created_at: optimisticCreatedAt,
        title: currentConversation?.title || 'New Conversation',
        message_count: 1,
      });

      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => {
        const baseConversation = prev || {
          id: conversationIdForRequest,
          created_at: optimisticCreatedAt,
          title: 'New Conversation',
          messages: [],
        };

        return {
          ...baseConversation,
          messages: [...(baseConversation.messages || []), userMessage],
        };
      });

      const assistantMessageId =
        (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
        `assistant_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const councilOrder = runtimeConfig?.council_models || [];
      const assistantMessage = {
        id: assistantMessageId,
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        stream: {
          stage1: {},
          stage2: {},
          stage3: { response: '', thinking: '' },
        },
        streamMeta: {
          stage1: Object.fromEntries(councilOrder.map((model) => [model, { status: 'idle' }])),
          stage2: Object.fromEntries(councilOrder.map((model) => [model, { status: 'idle' }])),
          stage3: { status: 'idle' },
        },
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      setCurrentConversation((prev) => {
        const baseConversation = prev || {
          id: conversationIdForRequest,
          created_at: optimisticCreatedAt,
          title: 'New Conversation',
          messages: [],
        };

        return {
          ...baseConversation,
          messages: [...(baseConversation.messages || []), assistantMessage],
        };
      });

      const updateAssistantMessage = (recipeFn) => {
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const index = prev.messages.findIndex(
            (message) => message.role === 'assistant' && message.id === assistantMessageId
          );
          if (index === -1) return prev;

          const target = prev.messages[index];
          const updated = recipeFn({
            ...target,
            loading: { ...(target.loading || {}) },
            metadata: target.metadata ? { ...target.metadata } : target.metadata,
          });

          const messages = [...prev.messages];
          messages[index] = updated;
          return { ...prev, messages };
        });
      };

      const streamUpdateQueueRef = { current: [] };
      const streamUpdateScheduledRef = { current: false };
      const enqueueAssistantUpdate = (fn) => {
        streamUpdateQueueRef.current.push(fn);
        if (streamUpdateScheduledRef.current) return;
        streamUpdateScheduledRef.current = true;
        window.requestAnimationFrame(() => {
          streamUpdateScheduledRef.current = false;
          const queued = streamUpdateQueueRef.current;
          streamUpdateQueueRef.current = [];
          if (queued.length === 0) return;
          updateAssistantMessage((message) => queued.reduce((acc, currentFn) => currentFn(acc), message));
        });
      };

      let receivedCompleteEvent = false;
      await api.sendMessageStream(conversationIdForRequest, { content }, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            updateAssistantMessage((message) => ({
              ...message,
              loading: { ...message.loading, stage1: true },
            }));
            break;

          case 'stage1_model_start':
            enqueueAssistantUpdate((message) => ({
              ...message,
              stream: {
                ...message.stream,
                stage1: {
                  ...message.stream.stage1,
                  [event.model]: { response: '', thinking: '' },
                },
              },
              streamMeta: {
                ...message.streamMeta,
                stage1: {
                  ...message.streamMeta.stage1,
                  [event.model]: { status: 'running' },
                },
              },
            }));
            break;

          case 'stage1_model_delta':
            enqueueAssistantUpdate((message) => {
              const previous = message.stream?.stage1?.[event.model] || {
                response: '',
                thinking: '',
              };
              const next = { ...previous };
              if (event.delta_type === 'content') next.response += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return {
                ...message,
                stream: {
                  ...message.stream,
                  stage1: { ...message.stream.stage1, [event.model]: next },
                },
              };
            });
            break;

          case 'stage1_model_error':
            console.error('Stage 1 model error:', event.model, event.message);
            enqueueAssistantUpdate((message) => ({
              ...message,
              streamMeta: {
                ...message.streamMeta,
                stage1: {
                  ...message.streamMeta.stage1,
                  [event.model]: { status: 'error', message: event.message },
                },
              },
            }));
            break;

          case 'stage1_complete':
            updateAssistantMessage((message) => ({
              ...message,
              stage1: event.data,
              streamMeta: {
                ...message.streamMeta,
                stage1: Object.fromEntries(
                  Object.keys(message.streamMeta?.stage1 || {}).map((model) => [
                    model,
                    {
                      status: (event.data || []).some((result) => result?.model === model)
                        ? 'complete'
                        : message.streamMeta?.stage1?.[model]?.status || 'idle',
                    },
                  ])
                ),
              },
              loading: { ...message.loading, stage1: false },
            }));
            break;

          case 'stage2_start':
            updateAssistantMessage((message) => ({
              ...message,
              loading: { ...message.loading, stage2: true },
            }));
            break;

          case 'stage2_model_start':
            enqueueAssistantUpdate((message) => ({
              ...message,
              stream: {
                ...message.stream,
                stage2: {
                  ...message.stream.stage2,
                  [event.model]: { ranking: '', thinking: '' },
                },
              },
              streamMeta: {
                ...message.streamMeta,
                stage2: {
                  ...message.streamMeta.stage2,
                  [event.model]: { status: 'running' },
                },
              },
            }));
            break;

          case 'stage2_model_delta':
            enqueueAssistantUpdate((message) => {
              const previous = message.stream?.stage2?.[event.model] || {
                ranking: '',
                thinking: '',
              };
              const next = { ...previous };
              if (event.delta_type === 'content') next.ranking += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return {
                ...message,
                stream: {
                  ...message.stream,
                  stage2: { ...message.stream.stage2, [event.model]: next },
                },
              };
            });
            break;

          case 'stage2_model_error':
            console.error('Stage 2 model error:', event.model, event.message);
            enqueueAssistantUpdate((message) => ({
              ...message,
              streamMeta: {
                ...message.streamMeta,
                stage2: {
                  ...message.streamMeta.stage2,
                  [event.model]: { status: 'error', message: event.message },
                },
              },
            }));
            break;

          case 'stage2_complete':
            updateAssistantMessage((message) => ({
              ...message,
              stage2: event.data,
              metadata: event.metadata,
              streamMeta: {
                ...message.streamMeta,
                stage2: Object.fromEntries(
                  Object.keys(message.streamMeta?.stage2 || {}).map((model) => [
                    model,
                    {
                      status: (event.data || []).some((result) => result?.model === model)
                        ? 'complete'
                        : message.streamMeta?.stage2?.[model]?.status || 'idle',
                    },
                  ])
                ),
              },
              loading: { ...message.loading, stage2: false },
            }));
            break;

          case 'stage3_start':
            updateAssistantMessage((message) => ({
              ...message,
              stream: {
                ...message.stream,
                stage3: { response: '', thinking: '' },
              },
              streamMeta: {
                ...message.streamMeta,
                stage3: { status: 'running' },
              },
              loading: { ...message.loading, stage3: true },
            }));
            break;

          case 'stage3_delta':
            enqueueAssistantUpdate((message) => {
              const previous = message.stream?.stage3 || { response: '', thinking: '' };
              const next = { ...previous };
              if (event.delta_type === 'content') next.response += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return {
                ...message,
                stream: { ...message.stream, stage3: next },
              };
            });
            break;

          case 'stage3_error':
            console.error('Stage 3 error:', event.message);
            enqueueAssistantUpdate((message) => ({
              ...message,
              streamMeta: {
                ...message.streamMeta,
                stage3: { status: 'error', message: event.message },
              },
            }));
            setLastProviderError(event.message || 'Failed to complete final synthesis');
            break;

          case 'stage3_complete':
            updateAssistantMessage((message) => ({
              ...message,
              stage3: event.data,
              streamMeta: {
                ...message.streamMeta,
                stage3: { status: 'complete' },
              },
              loading: { ...message.loading, stage3: false },
            }));
            break;

          case 'title_complete':
            if (event?.data?.title) {
              upsertConversationInSidebar({
                id: conversationIdForRequest,
                title: event.data.title,
              });
            }
            loadConversations();
            break;

          case 'complete':
            receivedCompleteEvent = true;
            (async () => {
              await loadConversations();
              setIsLoading(false);
            })();
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setLastProviderError(event.message || 'Failed to run MDT');
            setIsLoading(false);
            break;

          default:
            break;
        }
      });

      setIsRefreshingAfterStream(true);
      await loadConversations();
      await loadConversation(conversationIdForRequest);
      setIsRefreshingAfterStream(false);
      setDraftConversationId((prev) => (prev === conversationIdForRequest ? null : prev));
      if (!receivedCompleteEvent) setIsLoading(false);
    } catch (error) {
      console.error('Failed to send message:', error);
      setLastProviderError(error instanceof Error ? error.message : String(error));
      setCurrentConversation((prev) => {
        if (!prev) return prev;
        const messages = [...(prev.messages || [])];
        if (messages.length >= 2) {
          messages.splice(-2, 2);
        }
        return { ...prev, messages };
      });
      setIsLoading(false);
      setIsRefreshingAfterStream(false);
    }
  };

  return (
    <>
      <div className="app">
        <Sidebar
          conversations={conversations}
          groupedConversations={groupConversationsByDate(conversations)}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapsed={null}
        />
        <div className="main">
          <TopBar
            title={currentConversation?.title || 'LLM MDT'}
            status={providerStatus}
            statusText={providerStatusText}
            onNewConversation={handleNewConversation}
            onOpenSettings={handleOpenSettings}
          />
          <ChatInterface
            conversation={currentConversation}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            runtimeConfig={runtimeConfig}
            providerConfigured={providerConfigured}
            providerStatus={providerStatus}
            onOpenSettings={handleOpenSettings}
          />
        </div>
      </div>

      <SettingsDialog
        isOpen={isSettingsOpen}
        settings={providerSettings}
        error={settingsError}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        onClear={handleClearSettings}
      />
    </>
  );
}

export default App;
