import './TopBar.css';
import Button from './Button';

export default function TopBar({
  title,
  status = 'ready',
  statusText = '',
  onNewConversation,
  onOpenSettings,
}) {
  const showActions = !!(onOpenSettings || onNewConversation);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className={`status-dot ${status}`} title={statusText || status} />
        <div className="topbar-title-group">
          <div className="topbar-title">{title || 'LLM MDT'}</div>
          <div className="topbar-status-text">{statusText || status}</div>
        </div>
      </div>
      {showActions ? (
        <div className="topbar-right">
          {onOpenSettings ? (
            <Button
              variant="ghost"
              className="topbar-btn topbar-btn-text"
              type="button"
              onClick={onOpenSettings}
              title="Provider settings"
            >
              Settings
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
