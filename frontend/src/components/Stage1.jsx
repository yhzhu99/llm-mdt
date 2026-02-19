import { useMemo, useState } from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage1.css';

function ModelThinking({ show }) {
  if (!show) return null;
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

function TabThinking({ show }) {
  if (!show) return null;
  return (
    <span className="tab-thinking" aria-label="thinking">
      <span className="spinner tab-spinner" aria-hidden="true"></span>
      <span className="tab-thinking-text">思考中</span>
    </span>
  );
}

export default function Stage1({ responses, streamState, streamMeta, councilOrder }) {
  const [activeTab, setActiveTab] = useState(0);
  const [showThinking, setShowThinking] = useState(false);

  const tabs = useMemo(() => {
    const preferred = Array.isArray(councilOrder) ? councilOrder.filter(Boolean) : [];
    if (preferred.length > 0) return preferred;

    // Fallback if runtime config isn't available: build a stable set from known keys.
    const set = new Set();
    for (const r of responses || []) if (r?.model) set.add(r.model);
    for (const m of Object.keys(streamState || {})) if (m) set.add(m);
    for (const m of Object.keys(streamMeta || {})) if (m) set.add(m);
    return [...set];
  }, [responses, streamState, streamMeta, councilOrder]);

  if (tabs.length === 0) {
    return null;
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

  const hasStartedMainOutput = (model) => {
    const fromFinal = (responses || []).find((r) => r?.model === model)?.response;
    const fromStream = streamState?.[model]?.response;
    return !!((fromFinal && String(fromFinal).length > 0) || (fromStream && String(fromStream).length > 0));
  };

  // Definition: per-model "thinking" until it starts printing main output.
  const isThinking = (model) => (streamMeta?.[model]?.status === 'running') && !hasStartedMainOutput(model);
  const _activeStatus = streamMeta?.[activeModel]?.status || (active ? 'complete' : 'idle');

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
            <TabThinking show={isThinking(model)} />
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
          <ModelThinking show={isThinking(activeModel)} />
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
