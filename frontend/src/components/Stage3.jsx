import Markdown from './Markdown';
import CopyButton from './CopyButton';
import StageCard from './StageCard';
import './Stage3.css';

export default function Stage3({ finalResponse }) {
  if (!finalResponse) {
    return null;
  }

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
        </div>
      }
    >
      <div className="final-text markdown-content">
        <Markdown>{finalResponse.response}</Markdown>
      </div>
    </StageCard>
  );
}
