import { useState } from 'react';
import CopyButton from './CopyButton';
import './TraceLog.css';

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function TraceLog({ assistantMessage }) {
  const [open, setOpen] = useState(false);

  if (!assistantMessage) return null;
  const metadata = assistantMessage.metadata;
  if (!metadata) return null;

  const text = safeJson(metadata);

  return (
    <div className="trace-log">
      <div className="trace-log__header">
        <button
          type="button"
          className="trace-log__toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide trace log' : 'Show trace log'}
        </button>
        <CopyButton
          label="Copy log"
          successLabel="Copied"
          getText={() => text}
          title="Copy full trace log (metadata JSON)"
        />
      </div>

      {open && (
        <pre className="trace-log__pre">
          <code>{text}</code>
        </pre>
      )}
    </div>
  );
}

