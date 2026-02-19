import { useState, useEffect, useRef } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import './ChatInterface.css';

function assistantMessageToCopyText(msg) {
  const stage1 = msg.stage1 || [];
  const stage2 = msg.stage2 || [];
  const stage3 = msg.stage3 || null;
  const metadata = msg.metadata || null;

  const lines = [];

  lines.push('## Stage 1');
  if (stage1.length === 0) {
    lines.push('(no data)');
  } else {
    for (const item of stage1) {
      lines.push(`### ${item.model}`);
      lines.push(item.response || '');
      lines.push('');
    }
  }

  lines.push('## Stage 2');
  if (stage2.length === 0) {
    lines.push('(no data)');
  } else {
    for (const item of stage2) {
      lines.push(`### Voter: ${item.model}`);
      lines.push(item.ranking || '');
      if (item.parsed_ranking?.length) {
        lines.push('');
        lines.push('Parsed ranking:');
        for (const label of item.parsed_ranking) {
          lines.push(`- ${label}`);
        }
      }
      lines.push('');
    }
  }

  if (metadata) {
    lines.push('## Stage 2 Metadata');
    lines.push('');
    if (metadata.label_to_model) {
      lines.push('label_to_model:');
      lines.push(JSON.stringify(metadata.label_to_model, null, 2));
      lines.push('');
    }
    if (metadata.aggregate_rankings) {
      lines.push('aggregate_rankings:');
      lines.push(JSON.stringify(metadata.aggregate_rankings, null, 2));
      lines.push('');
    }
    if (metadata.positions_by_model) {
      lines.push('positions_by_model:');
      lines.push(JSON.stringify(metadata.positions_by_model, null, 2));
      lines.push('');
    }
    if (metadata.stage2_parsed_rankings) {
      lines.push('stage2_parsed_rankings:');
      lines.push(JSON.stringify(metadata.stage2_parsed_rankings, null, 2));
      lines.push('');
    }
  }

  lines.push('## Stage 3');
  if (!stage3) {
    lines.push('(no data)');
  } else {
    lines.push(`Chairman: ${stage3.model || ''}`);
    lines.push(stage3.response || '');
  }

  return lines.join('\n');
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">
                    <span>You</span>
                    <CopyButton
                      label="Copy message"
                      successLabel="Copied"
                      getText={() => msg.content || ''}
                    />
                  </div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">
                    <span>LLM Council</span>
                    <CopyButton
                      label="Copy message"
                      successLabel="Copied"
                      getText={() => assistantMessageToCopyText(msg)}
                    />
                  </div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 && (
        <form className="input-form" onSubmit={handleSubmit}>
          <textarea
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={3}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!input.trim() || isLoading}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
