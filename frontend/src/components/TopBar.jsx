import './TopBar.css';
import Button from './Button';

export default function TopBar({
  title,
  status = 'connected', // connected | connecting | disconnected
  onNewConversation,
  onRefresh,
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className={`status-dot ${status}`} title={status} />
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
