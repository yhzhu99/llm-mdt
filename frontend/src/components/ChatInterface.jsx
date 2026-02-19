import { useState, useEffect, useRef } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import TraceLog from './TraceLog';
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

const IconPaperclip = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M21.44 11.05l-8.49 8.49a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.19 9.19a2 2 0 01-2.83-2.83l8.49-8.49"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
};

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  onNewConversation,
}) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    const canSend = (input.trim().length > 0 || images.length > 0) && !isLoading;
    if (canSend) {
      onSendMessage(input, images.map((img) => img.dataUrl));
      setInput('');
      setImages([]);
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

  const canSend = (input.trim().length > 0 || images.length > 0) && !isLoading;

  const handlePickImages = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => (f?.type || '').startsWith('image/'));
    if (files.length === 0) return;

    const next = [];
    for (const file of files) {
      // Simple guardrail; data URLs can get huge.
      const MAX_BYTES = 5 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        // eslint-disable-next-line no-alert
        window.alert(`Image too large: ${file.name} (max 5MB)`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await readFileAsDataUrl(file);
      next.push({
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl,
      });
    }
    setImages((prev) => [...prev, ...next]);
  };

  const isSingleTurnLocked = !!conversation?.messages?.some((m) => m?.role === 'user');

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="file-input-hidden"
                onChange={(e) => {
                  handlePickImages(e.target.files);
                  // allow picking the same file again
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="icon-button"
                title="Upload images"
                onClick={() => fileInputRef.current?.click?.()}
                disabled={isLoading}
              >
                <IconPaperclip />
              </button>
              <button
                type="submit"
                className="send-button icon-only"
                disabled={!canSend}
                title="Send"
              >
                <IconArrowUp />
              </button>
            </div>
            {images.length > 0 ? (
              <div className="image-chips">
                {images.map((img, idx) => (
                  <div className="image-chip" key={`${img.name}_${idx}`}>
                    <span className="image-chip-name">
                      {img.name}
                      {img.size ? ` (${formatFileSize(img.size)})` : ''}
                    </span>
                    <button
                      type="button"
                      className="image-chip-remove"
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== idx))}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </form>
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
                      <div className="assistant-title">LLM Council</div>
                    </div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65 blue" />
                        <div className="skeleton-line w85" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} streamState={msg.stream?.stage1} />}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65" />
                        <div className="skeleton-line w85 blue" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                      streamState={msg.stream?.stage2}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <div className="loading-lines">
                        <div className="skeleton-line w65 green" />
                        <div className="skeleton-line w85" />
                        <div className="skeleton-line w40" />
                      </div>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} streamState={msg.stream?.stage3} />}

                  <TraceLog assistantMessage={msg} />
                  </div>
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

      {isSingleTurnLocked ? null : (
        <form className="input-form" onSubmit={handleSubmit}>
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

          {images.length > 0 ? (
            <div className="image-chips">
              {images.map((img, idx) => (
                <div className="image-chip" key={`${img.name}_${idx}`}>
                  <span className="image-chip-name">
                    {img.name}
                    {img.size ? ` (${formatFileSize(img.size)})` : ''}
                  </span>
                  <button
                    type="button"
                    className="image-chip-remove"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== idx))}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="composer-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="file-input-hidden"
              onChange={(e) => {
                handlePickImages(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="icon-button"
              title="Upload images"
              onClick={() => fileInputRef.current?.click?.()}
              disabled={isLoading}
            >
              <IconPaperclip />
            </button>
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
          </div>
        </form>
      )}
    </div>
  );
}
