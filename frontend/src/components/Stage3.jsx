import React from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage3.css';

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

export default function Stage3({ finalResponse, streamState }) {
  const [showThinking, setShowThinking] = React.useState(false);
  const model = finalResponse?.model || 'chairman';
  const responseText = finalResponse?.response || streamState?.response || '';
  const thinkingText = finalResponse?.reasoning_details ?? streamState?.thinking ?? '';

  if (!responseText && !thinkingText) return null;

  return (
    <StageCard
      title="Stage 3"
      subtitle={`Final synthesis (Chairman: ${model.split('/')[1] || model})`}
      className="stage3"
      right={
        <div className="stage-actions">
          <CopyButton
            iconOnly
            label="Copy"
            successLabel="Copied"
            getText={() => responseText || ''}
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
      }
    >
      <div className="final-text markdown-content">
        <Markdown>{responseText}</Markdown>
      </div>

      {showThinking && (
        <div className="thinking-panel">
          <div className="thinking-head">Thinking</div>
          <ThinkingBlock text={thinkingText} />
        </div>
      )}
    </StageCard>
  );
}
