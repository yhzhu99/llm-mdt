import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import TopBar from './components/TopBar';
import { api } from './api';
import './App.css';

const groupConversationsByDate = (conversations) => {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const sorted = [...(conversations || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  for (const conv of sorted) {
    const d = new Date(conv.created_at);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let groupName = '';
    if (day.getTime() === today.getTime()) groupName = 'Today';
    else if (day.getTime() > oneWeekAgo.getTime()) groupName = 'Last 7 days';
    else if (day.getTime() > oneMonthAgo.getTime()) groupName = 'Last 30 days';
    else groupName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(conv);
  }
  return groups;
};

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // Draft conversation: created when user lands on main panel and starts typing.
  // It is NOT added to the sidebar until the first message is actually sent.
  const [draftConversationId, setDraftConversationId] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // connected | connecting | disconnected

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Periodic health check (drive connection status dot like MedX).
  useEffect(() => {
    let alive = true;
    let timer = null;

    const tick = async () => {
      if (!alive) return;
      setConnectionStatus((prev) => (prev === 'connected' ? 'connected' : 'connecting'));
      try {
        await api.health();
        if (!alive) return;
        setConnectionStatus('connected');
      } catch {
        if (!alive) return;
        setConnectionStatus('disconnected');
      }
    };

    tick();
    timer = window.setInterval(tick, 4000);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

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

    // If user is sending from the landing page, lazily create a draft conversation
    // (kept out of the sidebar until a message is successfully sent).
    if (draftConversationId) {
      setCurrentConversationId(draftConversationId);
      return draftConversationId;
    }

    const newConv = await api.createConversation();
    setDraftConversationId(newConv.id);
    setCurrentConversationId(newConv.id);
    return newConv.id;
  };

  const handleSendMessage = async (content, images = []) => {
    let conversationIdForRequest;

    try {
      conversationIdForRequest = await ensureConversationForSend();
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return;
    }

    setIsLoading(true);
    try {
      // Ensure we have a local conversation object for optimistic UI.
      setCurrentConversation((prev) => {
        if (prev) return prev;
        return {
          id: conversationIdForRequest,
          created_at: new Date().toISOString(),
          messages: [],
        };
      });

      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), userMessage],
      }));

      const assistantMessageId =
        (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
        `assistant_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      // Create a partial assistant message that will be updated progressively
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
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), assistantMessage],
      }));

      const updateAssistantMessage = (recipeFn) => {
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const index = prev.messages.findIndex(
            (m) => m.role === 'assistant' && m.id === assistantMessageId
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

      // Send message with streaming
      await api.sendMessageStream(
        conversationIdForRequest,
        { content, images },
        (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              loading: { ...msg.loading, stage1: true },
            }));
            break;

          case 'stage1_model_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              stream: {
                ...msg.stream,
                stage1: {
                  ...msg.stream.stage1,
                  [event.model]: { response: '', thinking: '' },
                },
              },
            }));
            break;

          case 'stage1_model_delta':
            updateAssistantMessage((msg) => {
              const prev = msg.stream?.stage1?.[event.model] || { response: '', thinking: '' };
              const next = { ...prev };
              if (event.delta_type === 'content') next.response += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return {
                ...msg,
                stream: {
                  ...msg.stream,
                  stage1: { ...msg.stream.stage1, [event.model]: next },
                },
              };
            });
            break;

          case 'stage1_model_error':
            console.error('Stage1 model error:', event.model, event.message);
            break;

          case 'stage1_complete':
            updateAssistantMessage((msg) => ({
              ...msg,
              stage1: event.data,
              loading: { ...msg.loading, stage1: false },
            }));
            break;

          case 'stage2_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              loading: { ...msg.loading, stage2: true },
            }));
            break;

          case 'stage2_model_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              stream: {
                ...msg.stream,
                stage2: {
                  ...msg.stream.stage2,
                  [event.model]: { ranking: '', thinking: '' },
                },
              },
            }));
            break;

          case 'stage2_model_delta':
            updateAssistantMessage((msg) => {
              const prev = msg.stream?.stage2?.[event.model] || { ranking: '', thinking: '' };
              const next = { ...prev };
              if (event.delta_type === 'content') next.ranking += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return {
                ...msg,
                stream: {
                  ...msg.stream,
                  stage2: { ...msg.stream.stage2, [event.model]: next },
                },
              };
            });
            break;

          case 'stage2_model_error':
            console.error('Stage2 model error:', event.model, event.message);
            break;

          case 'stage2_complete':
            updateAssistantMessage((msg) => ({
              ...msg,
              stage2: event.data,
              metadata: event.metadata,
              loading: { ...msg.loading, stage2: false },
            }));
            break;

          case 'stage3_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              stream: {
                ...msg.stream,
                stage3: { response: '', thinking: '' },
              },
              loading: { ...msg.loading, stage3: true },
            }));
            break;

          case 'stage3_delta':
            updateAssistantMessage((msg) => {
              const prev = msg.stream?.stage3 || { response: '', thinking: '' };
              const next = { ...prev };
              if (event.delta_type === 'content') next.response += event.text || '';
              if (event.delta_type === 'reasoning') next.thinking += event.text || '';
              return { ...msg, stream: { ...msg.stream, stage3: next } };
            });
            break;

          case 'stage3_error':
            console.error('Stage3 error:', event.message);
            break;

          case 'stage3_complete':
            updateAssistantMessage((msg) => ({
              ...msg,
              stage3: event.data,
              loading: { ...msg.loading, stage3: false },
            }));
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list and refresh current conversation.
            (async () => {
              await loadConversations();
              if (conversationIdForRequest === currentConversationId) {
                await loadConversation(conversationIdForRequest);
              }
              setIsLoading(false);
            })();
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });

      // Best-effort final refresh: covers cases where stream ends without `complete`
      // (e.g. network interruption or parsing edge cases).
      await loadConversations();
      if (conversationIdForRequest === currentConversationId) {
        await loadConversation(conversationIdForRequest);
      }

      // If this message was sent in a draft conversation, it now has content
      // and should appear in the sidebar.
      setDraftConversationId((prev) => (prev === conversationIdForRequest ? null : prev));
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  return (
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
        onToggleCollapsed={() => setIsSidebarCollapsed((v) => !v)}
      />
      <div className="main">
        <TopBar
          title={currentConversation?.title || 'LLM Council'}
          status={connectionStatus}
          onNewConversation={handleNewConversation}
          onRefresh={loadConversations}
        />
        <ChatInterface
          conversation={currentConversation}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          onNewConversation={handleNewConversation}
        />
      </div>
    </div>
  );
}

export default App;
