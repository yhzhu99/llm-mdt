import './TopBar.css';
import Button from './Button';

export default function TopBar({ title, onNewConversation, onRefresh }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="status-dot" title="Local mode" />
        <div className="topbar-title">{title || 'LLM Council'}</div>
      </div>
      <div className="topbar-right">
        <Button
          variant="ghost"
          className="topbar-btn"
          type="button"
          onClick={onRefresh}
          title="Refresh"
        >
          ↻
        </Button>
        <Button
          variant="ghost"
          className="topbar-btn"
          type="button"
          onClick={onNewConversation}
          title="New chat"
        >
          +
        </Button>
      </div>
    </header>
  );
}
