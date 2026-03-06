import { useState, useEffect, useRef } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import TraceLog from './TraceLog';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import './ChatInterface.css';

const IconArrowUp = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M12 19V5"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 12l7-7 7 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  runtimeConfig,
  providerConfigured,
  onOpenSettings,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    // Only auto-scroll if user is already near the bottom (MedX behavior).
    const container = el.parentElement;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const NEAR_BOTTOM_PX = 160;
    if (distanceToBottom <= NEAR_BOTTOM_PX) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation]);

  // Ensure stream updates keep the viewport near bottom (best-effort).
  useEffect(() => {
    if (!isLoading) return;
    const el = messagesEndRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const NEAR_BOTTOM_PX = 220;
    if (distanceToBottom <= NEAR_BOTTOM_PX) {
      el.scrollIntoView({ behavior: 'auto' });
    }
  }, [isLoading, conversation?.messages?.length]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const canSend = input.trim().length > 0 && !isLoading;
    if (canSend) {
      onSendMessage(input);
      setInput('');
      // Keep typing flow: re-focus and reset height after send.
      window.setTimeout(() => {
        inputRef.current?.focus?.();
        autosizeTextarea();
      }, 0);
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const autosizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;
    // Reset height to let it shrink, then grow to content.
    el.style.height = 'auto';
    const maxPx = 280;
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  };

  useEffect(() => {
    autosizeTextarea();
  }, [input]);

  const canSend = input.trim().length > 0 && !isLoading && providerConfigured;
  const councilOrder = runtimeConfig?.council_models || [];

  const isSingleTurnLocked = !!conversation?.messages?.some((m) => m?.role === 'user');

  if (!conversation) {
    if (!providerConfigured) {
      return (
        <div className="chat-interface">
          <div className="empty-state">
            <h2>Configure your browser provider</h2>
            <p>LLM MDT runs entirely in this browser and stores your settings locally.</p>

            <div className="empty-actions">
              <button type="button" className="primary-action" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM MDT</h2>
          <p>Start a new chat from here</p>

          <form className="input-form centered" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              className="message-input"
              placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={3}
            />
            <div className="composer-actions">
              <button
                type="submit"
                className="send-button icon-only"
                disabled={!canSend}
                title="Send"
              >
                <IconArrowUp />
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // (Unused stream helper functions were removed.)

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            {providerConfigured ? (
              <>
                <h2>Start a conversation</h2>
                <p>Ask a question to consult the LLM MDT</p>
              </>
            ) : (
              <>
                <h2>Provider setup required</h2>
                <p>Configure a browser-capable endpoint before starting a new MDT run.</p>
                <div className="empty-actions">
                  <button type="button" className="primary-action" onClick={onOpenSettings}>
                    Open Settings
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message message-bubble">
                  <div className="user-card">
                    <div className="user-card-head">
                      <div className="user-title">You</div>
                      <CopyButton
                        iconOnly
                        label="Copy message"
                        successLabel="Copied"
                        getText={() => msg.content || ''}
                      />
                    </div>
                    <div className="user-card-body">
                      <div className="markdown-content">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message message-bubble">
                  <div className="assistant-card">
                    <div className="assistant-card-head">
                      <div className="assistant-title">LLM MDT</div>
                    </div>

                  {(() => {
                    const hasStreamStage1 = !!(
                      msg.stream?.stage1 && Object.keys(msg.stream.stage1).length > 0
                    );
                    const hasStreamStage2 = !!(
                      msg.stream?.stage2 && Object.keys(msg.stream.stage2).length > 0
                    );
                    const hasStreamStage3 = !!(
                      msg.stream?.stage3 &&
                      (msg.stream.stage3.response || msg.stream.stage3.thinking)
                    );

                    return (
                      <>
                  {/* Stage 1 */}
                  {msg.loading?.stage1 && !hasStreamStage1 && (
                    <div className="stage-loading" aria-live="polite">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65 blue" />
                        <div className="skeleton-line w85" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {(msg.stage1 || (msg.stream?.stage1 && Object.keys(msg.stream.stage1).length > 0)) && (
                    <Stage1
                      responses={msg.stage1 || []}
                      streamState={msg.stream?.stage1}
                      streamMeta={msg.streamMeta?.stage1}
                      councilOrder={councilOrder}
                    />
                  )}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && !hasStreamStage2 && (
                    <div className="stage-loading" aria-live="polite">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65" />
                        <div className="skeleton-line w85 blue" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {(msg.stage2 || (msg.stream?.stage2 && Object.keys(msg.stream.stage2).length > 0)) && (
                    <Stage2
                      rankings={msg.stage2 || []}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                      streamState={msg.stream?.stage2}
                      streamMeta={msg.streamMeta?.stage2}
                      councilOrder={councilOrder}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && !hasStreamStage3 && (
                    <div className="stage-loading" aria-live="polite">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65 green" />
                        <div className="skeleton-line w85" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {(msg.stage3 || (msg.stream?.stage3 && (msg.stream.stage3.response || msg.stream.stage3.thinking))) && (
                    <Stage3 finalResponse={msg.stage3} streamState={msg.stream?.stage3} streamMeta={msg.streamMeta?.stage3} />
                  )}

                  <TraceLog assistantMessage={msg} />

                      </>
                    );
                  })()}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      {isSingleTurnLocked ? null : (
        <form className="input-form" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || !providerConfigured}
            rows={3}
          />

          <div className="composer-actions">
            <button
              type="submit"
              className="send-button icon-only"
              disabled={!canSend}
              title="Send"
            >
              <IconArrowUp />
            </button>
          </div>

          <div className="input-hint">
            <div className="hint-line">
              <span className="kbd">Enter</span> send
              <span className="hint-sep">·</span>
              <span className="kbd">Shift</span>+<span className="kbd">Enter</span> newline
            </div>
            {isLoading ? <div className="hint-sub">Generating…</div> : null}
            {!providerConfigured ? (
              <div className="hint-sub">
                Configure provider settings to start a browser-only MDT run.
              </div>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
