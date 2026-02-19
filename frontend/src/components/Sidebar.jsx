import './Sidebar.css';
import { useState } from 'react';

export default function Sidebar({
  conversations,
  groupedConversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  isCollapsed,
  onToggleCollapsed,
}) {
  const collapsible = typeof onToggleCollapsed === 'function';

  const visibleConversations = (conversations || []).filter(
    (c) => (c?.message_count ?? 0) > 0
  );

  const groups = groupedConversations || { Recent: visibleConversations };
  const groupEntries = Object.entries(groups).filter(
    ([, list]) => (list || []).filter((c) => (c?.message_count ?? 0) > 0).length > 0
  );

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
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
          {!isCollapsed && <div className="brand-name">LLM Council</div>}
        </div>

        {collapsible ? (
          <button
            type="button"
            className="sidebar-toggle btn ghost"
            onClick={onToggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '›' : '‹'}
          </button>
        ) : null}
      </div>

      <div className="sidebar-actions">
        <button
          type="button"
          className={`new-conversation-btn ${isCollapsed ? 'collapsed' : ''}`}
          onClick={onNewConversation}
          title="New Conversation"
        >
          <span className="new-conversation-icon" aria-hidden="true">＋</span>
          {!isCollapsed && <span className="new-conversation-label">New Conversation</span>}
        </button>
      </div>

      <div className="conversation-list scrollbar-hide">
        {visibleConversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          groupEntries.map(([groupName, list]) => (
            <div className="conversation-group" key={groupName}>
              {!isCollapsed && <div className="conversation-group-title">{groupName}</div>}
              <div className="conversation-group-list">
                {list
                  .filter((c) => (c?.message_count ?? 0) > 0)
                  .map((conv) => (
                    <ConversationRow
                      key={conv.id}
                      conv={conv}
                      active={conv.id === currentConversationId}
                      collapsed={!!isCollapsed}
                      onSelect={() => onSelectConversation(conv.id)}
                      onDelete={() => onDeleteConversation?.(conv.id)}
                      onRename={(title) => onRenameConversation?.(conv.id, title)}
                    />
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ConversationRow({ conv, active, collapsed, onSelect, onDelete, onRename }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conv.title || '');

  return (
    <div
      className={`conversation-item ${active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
      onClick={onSelect}
      title={conv.title || 'Conversation'}
      role="button"
      tabIndex={0}
      onContextMenu={(e) => {
        e.preventDefault();
        if (collapsed) return;
        setOpen(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect?.();
      }}
    >
      {!collapsed ? (
        <>
          <div className="conversation-row-main">
            {renaming ? (
              <input
                className="conversation-rename"
                value={draftTitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setRenaming(false);
                    onRename?.(draftTitle.trim() || 'Conversation');
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenaming(false);
                    setDraftTitle(conv.title || '');
                  }
                }}
                onBlur={() => {
                  setRenaming(false);
                  if ((draftTitle || '').trim() !== (conv.title || '').trim()) {
                    onRename?.((draftTitle || '').trim() || 'Conversation');
                  }
                }}
              />
            ) : (
              <div className="conversation-title">
                {conv.title || 'Conversation'}
              </div>
            )}
            <button
              type="button"
              className="conversation-more btn ghost"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
              title="More"
            >
              ···
            </button>
          </div>
          <div className="conversation-meta">{conv.message_count} messages</div>

          {open && (
            <>
              <div
                className="dropdown-overlay"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
              />
              <div
                className="conversation-dropdown"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="dropdown-item btn ghost"
                  onClick={() => {
                    setOpen(false);
                    setRenaming(true);
                    setDraftTitle(conv.title || '');
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="dropdown-item btn ghost danger"
                  onClick={() => {
                    setOpen(false);
                    onDelete?.();
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="conversation-dot" />
      )}
    </div>
  );
}
