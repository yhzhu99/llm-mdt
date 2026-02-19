import React from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage3.css';

function ThinkingInline({ status, show }) {
  if (status !== 'running') return null;
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

export default function Stage3({ finalResponse, streamState, streamMeta }) {
  const [showThinking, setShowThinking] = React.useState(false);
  const model = finalResponse?.model || 'chairman';
  // Definition: "thinking" persists until the main output starts printing
  // (i.e., any non-empty content in the main response area).
  // Reasoning/thinking tokens do NOT count as having started the main output.
  const responseText = finalResponse?.response || streamState?.response || '';
  const thinkingText = finalResponse?.reasoning_details ?? streamState?.thinking ?? '';

  if (!responseText && !thinkingText) return null;

  const status = streamMeta?.status || (finalResponse ? 'complete' : 'running');
  const hasStartedMainOutput = !!(responseText && responseText.length > 0);
  const showThinkingIndicator = status === 'running' && !hasStartedMainOutput;
  const statusText =
    status === 'error' ? '出错' :
    status === 'complete' ? '已完成' :
    (showThinkingIndicator ? '思考中' : '生成中');

  return (
    <StageCard
      title="Stage 3"
      subtitle={`最终综合（主席：${model.split('/')[1] || model}） · ${statusText}`}
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
            title="显示/隐藏思考过程"
          >
            {showThinking ? '隐藏思考' : '显示思考'}
          </button>
        </div>
      }
    >
      <div className="final-text markdown-content">
        <ThinkingInline status={status} show={showThinkingIndicator} />
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
