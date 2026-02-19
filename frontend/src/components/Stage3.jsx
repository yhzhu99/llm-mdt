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
  if (!finalResponse) {
    return null;
  }

  const thinkingText = finalResponse?.reasoning_details ?? streamState?.thinking ?? '';

  return (
    <StageCard
      title="Stage 3"
      subtitle={`Final synthesis (Chairman: ${finalResponse.model.split('/')[1] || finalResponse.model})`}
      className="stage3"
      right={
        <div className="stage-actions">
          <CopyButton
            iconOnly
            label="Copy"
            successLabel="Copied"
            getText={() => finalResponse.response || ''}
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
        <Markdown>{finalResponse.response}</Markdown>
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
