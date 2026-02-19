import './TopBar.css';
import Button from './Button';

export default function TopBar({
  title,
  status = 'connected', // connected | connecting | disconnected
  onNewConversation,
  onRefresh,
}) {
  const showActions = !!(onRefresh || onNewConversation);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className={`status-dot ${status}`} title={status} />
        <div className="topbar-title">{title || 'LLM MDT'}</div>
      </div>
      {showActions ? (
        <div className="topbar-right">
          {onRefresh ? (
            <Button
              variant="ghost"
              className="topbar-btn"
              type="button"
              onClick={onRefresh}
              title="Refresh"
            >
              ↻
            </Button>
          ) : null}
          {onNewConversation ? (
            <Button
              variant="ghost"
              className="topbar-btn"
              type="button"
              onClick={onNewConversation}
              title="New chat"
            >
              +
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
