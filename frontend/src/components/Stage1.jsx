import { useState } from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage1.css';

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

export default function Stage1({ responses, streamState }) {
  const [activeTab, setActiveTab] = useState(0);
  const [showThinking, setShowThinking] = useState(false);

  if (!responses || responses.length === 0) {
    return null;
  }

  const active = responses[activeTab];
  const streamForActive = (streamState && active?.model && streamState[active.model]) || null;
  const thinkingText = active?.reasoning_details ?? streamForActive?.thinking ?? '';

  return (
    <StageCard
      title="Stage 1"
      subtitle="Individual model responses"
    >
      <div className="stage-tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`stage-tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {resp.model.split('/')[1] || resp.model}
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
          <Markdown>{active.response}</Markdown>
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
