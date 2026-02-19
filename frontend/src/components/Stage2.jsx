import { useState } from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = model.split('/')[1] || model;
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
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

export default function Stage2({ rankings, labelToModel, aggregateRankings, streamState, streamMeta }) {
  const [activeTab, setActiveTab] = useState(0);
  const [showThinking, setShowThinking] = useState(false);

  const modelsFromStream = streamState ? Object.keys(streamState) : [];
  const tabs = (rankings || []).map((r) => r?.model).filter(Boolean);
  for (const m of modelsFromStream) {
    if (!tabs.includes(m)) tabs.push(m);
  }

  if (tabs.length === 0) {
    return null;
  }

  const activeModel = tabs[Math.min(activeTab, tabs.length - 1)];
  const activeRanking = (rankings || []).find((r) => r?.model === activeModel) || { model: activeModel, ranking: '', parsed_ranking: [] };
  const streamForActive = (streamState && activeModel && streamState[activeModel]) || null;
  const rawText = activeRanking?.ranking || streamForActive?.ranking || '';
  const displayText = deAnonymizeText(rawText, labelToModel);
  const thinkingText =
    activeRanking?.reasoning_details ?? streamForActive?.thinking ?? '';
  const displayThinking = deAnonymizeText(thinkingText, labelToModel);

  return (
    <StageCard
      title="Stage 2"
      subtitle="Peer evaluation and rankings (de-anonymized for readability)"
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
          <div className="stage-panel-label">{activeRanking.model}</div>
          <div className="stage-actions">
            <CopyButton
              iconOnly
              label="Copy"
              successLabel="Copied"
              getText={() => rawText}
              title="Copy raw evaluation (anonymous labels)"
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
        <div className="ranking-content markdown-content">
          <Markdown>
            {displayText}
          </Markdown>
        </div>

        {showThinking && (
          <div className="thinking-panel">
            <div className="thinking-head">Thinking</div>
            <ThinkingBlock text={displayThinking} />
          </div>
        )}

        {activeRanking.parsed_ranking &&
         activeRanking.parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <strong>Extracted Ranking:</strong>
            <ol>
              {activeRanking.parsed_ranking.map((label, i) => (
                <li key={i}>
                  {labelToModel && labelToModel[label]
                    ? labelToModel[label].split('/')[1] || labelToModel[label]
                    : label}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-card">
          <div className="aggregate-card-head">
            <div className="aggregate-card-title">Aggregate Rankings</div>
            <div className="stage-actions">
              <CopyButton
                iconOnly
                label="Copy"
                successLabel="Copied"
                getText={() => JSON.stringify(aggregateRankings, null, 2)}
                title="Copy aggregate rankings (JSON)"
              />
            </div>
          </div>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">#{index + 1}</span>
                <span className="rank-model">
                  {agg.model.split('/')[1] || agg.model}
                </span>
                <span className="rank-score">
                  Avg: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">
                  ({agg.rankings_count} votes)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </StageCard>
  );
}
