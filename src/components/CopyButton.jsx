import { useState } from 'react';
import './CopyButton.css';

async function writeToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for environments where Clipboard API is unavailable.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export default function CopyButton({
  getText,
  label = 'Copy',
  successLabel = 'Copied',
  className = '',
  title,
  iconOnly = false,
}) {
  const [status, setStatus] = useState('idle'); // idle | success | error

  const onCopy = async () => {
    try {
      const text = await getText();
      await writeToClipboard(text);
      setStatus('success');
      window.setTimeout(() => setStatus('idle'), 1200);
    } catch (e) {
      console.error('Copy failed:', e);
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 1200);
    }
  };

  const display = status === 'success' ? successLabel : label;
  const showToast = iconOnly && status === 'success';
  const visibleText = iconOnly ? '' : display;

  return (
    <span className={`copy-button__wrap ${className}`.trim()}>
      <button
        type="button"
        className={`copy-button ${iconOnly ? 'icon-only' : ''}`.trim()}
        onClick={onCopy}
        title={title || label}
      >
        <span className="copy-button__icon" aria-hidden="true">
          ⧉
        </span>
        {visibleText ? <span className="copy-button__text">{visibleText}</span> : null}
      </button>
      {showToast ? (
        <span className="copy-button__toast" role="status" aria-live="polite">
          {successLabel}
        </span>
      ) : null}
    </span>
  );
}
