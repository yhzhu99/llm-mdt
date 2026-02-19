import { useRef, useState } from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage1.css';

function ModelThinking({ status, hasText }) {
  if (status !== 'running') return null;
  if (hasText) return null;
  return (
    <div className="stage-thinking-inline" aria-live="polite">
      <div className="spinner"></div>
      <span>思考中…</span>
    </div>
  );
}

function ThinkingBlock({ text }) {
  if (!text || String(text).trim().length === 0) {
    return (
      <div className="thinking-empty">
        Model did not provide thinking / reasoning.
      </div>
    );
  }
  return (
    <div className="thinking-text markdown-content">
      <Markdown>{String(text)}</Markdown>
    </div>
  );
}

function statusDot(status) {
  const s = status || 'idle';
  const cls =
    s === 'running' ? 'stage-status-dot running' :
    s === 'complete' ? 'stage-status-dot complete' :
    s === 'error' ? 'stage-status-dot error' :
    'stage-status-dot';
  return <span className={cls} aria-hidden="true" />;
}

export default function Stage1({ responses, streamState, streamMeta }) {
  const [activeTab, setActiveTab] = useState(0);
  const [showThinking, setShowThinking] = useState(false);
  const lastModelRef = useRef(null);

  const modelsFromStream = streamState ? Object.keys(streamState) : [];
  const tabs = (responses || []).map((r) => r?.model).filter(Boolean);
  for (const m of modelsFromStream) {
    if (!tabs.includes(m)) tabs.push(m);
  }

  if (tabs.length === 0) {
    return null;
  }

  // When new tabs appear (streaming) or ordering changes, reset to the newest model.
  // This avoids "tab index reuse" bugs where switching tabs looks like content is "crossed".
  if (lastModelRef.current !== tabs[tabs.length - 1]) {
    lastModelRef.current = tabs[tabs.length - 1];
    if (activeTab !== 0) setActiveTab(0);
  }

  const activeModel = tabs[Math.min(activeTab, tabs.length - 1)];
  const active = (responses || []).find((r) => r?.model === activeModel) || { model: activeModel, response: '' };
  const streamForActive = (streamState && activeModel && streamState[activeModel]) || null;
  const thinkingText =
    active?.reasoning_details ?? streamForActive?.thinking ?? '';
  const responseText =
    (active?.response && String(active.response)) ||
    streamForActive?.response ||
    '';
  const hasAnyText = (responseText && responseText.length > 0) || (thinkingText && thinkingText.length > 0);
  const activeStatus = streamMeta?.[activeModel]?.status || (active ? 'complete' : 'idle');

  return (
    <StageCard
      title="Stage 1"
      subtitle="Individual model responses"
    >
      <div className="stage-tabs">
        {tabs.map((model, index) => (
          <button
            key={index}
            className={`stage-tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {statusDot(streamMeta?.[model]?.status)}
            {model.split('/')[1] || model}
          </button>
        ))}
      </div>

      <div className="stage-panel">
        <div className="stage-panel-head">
          <div className="stage-panel-label">{active.model}</div>
          <div className="stage-actions">
            <CopyButton
              iconOnly
              label="Copy"
              successLabel="Copied"
              getText={() => active.response || ''}
            />
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowThinking((v) => !v)}
              title="Toggle thinking"
            >
              {showThinking ? 'Hide thinking' : 'Show thinking'}
            </button>
          </div>
        </div>
        <div className="response-text markdown-content">
          <ModelThinking status={activeStatus} hasText={hasAnyText} />
          <Markdown>{responseText}</Markdown>
        </div>

        {showThinking && (
          <div className="thinking-panel">
            <div className="thinking-head">Thinking</div>
            <ThinkingBlock text={thinkingText} />
          </div>
        )}
      </div>
    </StageCard>
  );
}
