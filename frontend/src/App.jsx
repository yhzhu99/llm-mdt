import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

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

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    const conversationIdForRequest = currentConversationId;
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
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
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
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
      await api.sendMessageStream(conversationIdForRequest, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            updateAssistantMessage((msg) => ({
              ...msg,
              loading: { ...msg.loading, stage1: true },
            }));
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
              loading: { ...msg.loading, stage3: true },
            }));
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
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
    </div>
  );
}

export default App;
