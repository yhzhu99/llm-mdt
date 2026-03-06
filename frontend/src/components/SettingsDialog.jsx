import { useEffect, useMemo, useState } from 'react';
import Button from './Button';
import {
  DEFAULT_PROVIDER_SETTINGS,
  formatHeaderLines,
  formatModelList,
  parseHeaderLines,
} from '../services/providerSettings';
import './SettingsDialog.css';

function getInitialState(settings) {
  const source = settings || DEFAULT_PROVIDER_SETTINGS;
  return {
    baseUrl: source.baseUrl || '',
    apiKey: source.apiKey || '',
    councilModelsText: formatModelList(source.councilModels || []),
    chairmanModel: source.chairmanModel || '',
    titleModel: source.titleModel || source.chairmanModel || '',
    extraHeadersText: formatHeaderLines(source.extraHeaders || {}),
  };
}

export default function SettingsDialog({
  isOpen,
  settings,
  error,
  onClose,
  onSave,
  onClear,
}) {
  const [formState, setFormState] = useState(getInitialState(settings));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormState(getInitialState(settings));
    setIsSaving(false);
  }, [isOpen, settings]);

  const councilCount = useMemo(
    () =>
      formState.councilModelsText
        .split(/\r?\n|,/)
        .map((value) => value.trim())
        .filter(Boolean).length,
    [formState.councilModelsText]
  );

  if (!isOpen) return null;

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSave?.({
        baseUrl: formState.baseUrl,
        apiKey: formState.apiKey,
        councilModels: formState.councilModelsText,
        chairmanModel: formState.chairmanModel,
        titleModel: formState.titleModel,
        extraHeaders: parseHeaderLines(formState.extraHeadersText),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    try {
      await onClear?.();
      setFormState(getInitialState(DEFAULT_PROVIDER_SETTINGS));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-head">
          <div>
            <h2 id="settings-dialog-title">Browser Provider Settings</h2>
            <p>
              Stored only in this browser. Keys remain inspectable by anyone with
              access to this device and session.
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose} title="Close settings">
            ×
          </Button>
        </div>

        <div className="settings-alerts">
          <div className="settings-alert">
            <strong>Browser-only tradeoff:</strong> this is designed for personal use,
            not for protecting shared production secrets.
          </div>
          <div className="settings-alert">
            <strong>CORS required:</strong> the endpoint must allow direct browser-origin
            requests, or the MDT run will fail.
          </div>
        </div>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label className="settings-field">
            <span>OpenAI-compatible base URL</span>
            <input
              type="url"
              placeholder="https://openrouter.ai/api/v1/chat/completions"
              value={formState.baseUrl}
              onChange={updateField('baseUrl')}
              autoComplete="off"
            />
          </label>

          <label className="settings-field">
            <span>API key</span>
            <input
              type="password"
              placeholder="sk-or-v1-..."
              value={formState.apiKey}
              onChange={updateField('apiKey')}
              autoComplete="off"
            />
          </label>

          <label className="settings-field">
            <span>Council models</span>
            <textarea
              rows={5}
              placeholder="One model per line"
              value={formState.councilModelsText}
              onChange={updateField('councilModelsText')}
            />
            <small>{councilCount} model{councilCount === 1 ? '' : 's'} configured</small>
          </label>

          <div className="settings-grid">
            <label className="settings-field">
              <span>Chairman model</span>
              <input
                type="text"
                placeholder="google/gemini-3-pro-preview"
                value={formState.chairmanModel}
                onChange={updateField('chairmanModel')}
              />
            </label>

            <label className="settings-field">
              <span>Title model</span>
              <input
                type="text"
                placeholder="Defaults to chairman model"
                value={formState.titleModel}
                onChange={updateField('titleModel')}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>Extra headers</span>
            <textarea
              rows={4}
              placeholder={'HTTP-Referer: https://example.com\nX-Title: LLM MDT'}
              value={formState.extraHeadersText}
              onChange={updateField('extraHeadersText')}
            />
            <small>Optional. One header per line in <code>Name: Value</code> format.</small>
          </label>

          {error ? <div className="settings-error">{error}</div> : null}

          <div className="settings-actions">
            <Button variant="ghost" type="button" onClick={handleClear} disabled={isSaving}>
              Clear stored settings
            </Button>
            <div className="settings-actions-right">
              <Button variant="ghost" type="button" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
