import './TopBar.css';

export default function TopBar({ title }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="status-dot" title="Local mode" />
        <div className="topbar-title">{title || 'LLM Council'}</div>
      </div>
      <div className="topbar-right" />
    </header>
  );
}

