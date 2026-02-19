import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}) {
  const visibleConversations = (conversations || []).filter(
    (c) => (c?.message_count ?? 0) > 0
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div
          className="brand"
          onClick={onNewConversation}
          title="New chat"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onNewConversation?.();
          }}
        >
          <div className="brand-icon">C</div>
          <div className="brand-name">LLM Council</div>
        </div>
      </div>

      <div className="conversation-list">
        {visibleConversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          <div className="conversation-group">
            <div className="conversation-group-title">Recent</div>
            <div className="conversation-group-list">
              {visibleConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${
                    conv.id === currentConversationId ? 'active' : ''
                  }`}
                  onClick={() => onSelectConversation(conv.id)}
                  title={conv.title || 'Conversation'}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelectConversation?.(conv.id);
                  }}
                >
                  <div className="conversation-title">
                    {conv.title || 'Conversation'}
                  </div>
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
