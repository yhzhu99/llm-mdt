import { requestToPromise, withStore } from './browserDb';

const SETTINGS_KEY = 'provider';

export const DEFAULT_PROVIDER_SETTINGS = {
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: '',
  councilModels: [
    'openai/gpt-5.2',
    'google/gemini-3-pro-preview',
    'deepseek/deepseek-reasoner',
  ],
  chairmanModel: 'google/gemini-3-pro-preview',
  titleModel: 'google/gemini-3-pro-preview',
  extraHeaders: {},
};

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizeBaseUrl(value) {
  return String(value || '').trim();
}

export function parseModelList(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  return uniqueStrings(
    String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
  );
}

export function formatModelList(models) {
  return (models || []).join('\n');
}

export function parseHeaderLines(value) {
  const lines = String(value || '').split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    const headerValue = trimmed.slice(separatorIndex + 1).trim();
    if (!name || !headerValue) continue;
    entries.push([name, headerValue]);
  }

  return Object.fromEntries(entries);
}

export function formatHeaderLines(headers) {
  return Object.entries(headers || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

export function sanitizeProviderSettings(input) {
  const baseUrl = normalizeBaseUrl(input?.baseUrl ?? DEFAULT_PROVIDER_SETTINGS.baseUrl);
  const apiKey = String(input?.apiKey ?? '').trim();
  const councilModels = parseModelList(input?.councilModels ?? DEFAULT_PROVIDER_SETTINGS.councilModels);
  const chairmanModel =
    String(input?.chairmanModel || '').trim() || councilModels[0] || DEFAULT_PROVIDER_SETTINGS.chairmanModel;
  const titleModel =
    String(input?.titleModel || '').trim() || chairmanModel || DEFAULT_PROVIDER_SETTINGS.titleModel;
  const extraHeaders = Object.fromEntries(
    Object.entries(input?.extraHeaders || {}).filter(
      ([name, value]) => String(name || '').trim() && String(value || '').trim()
    )
  );

  return {
    baseUrl,
    apiKey,
    councilModels,
    chairmanModel,
    titleModel,
    extraHeaders,
  };
}

export function validateProviderSettings(input) {
  const settings = sanitizeProviderSettings(input);

  if (!settings.baseUrl) {
    throw new Error('Enter an OpenAI-compatible base URL.');
  }

  if (!settings.apiKey) {
    throw new Error('Enter an API key to use the browser-only provider.');
  }

  if (settings.councilModels.length === 0) {
    throw new Error('Enter at least one council model.');
  }

  if (!settings.chairmanModel) {
    throw new Error('Enter a chairman model.');
  }

  return settings;
}

export function isProviderConfigured(settings) {
  const sanitized = sanitizeProviderSettings(settings);
  return Boolean(
    sanitized.baseUrl &&
      sanitized.apiKey &&
      sanitized.councilModels.length > 0 &&
      sanitized.chairmanModel
  );
}

export const settingsStore = {
  async get() {
    const record = await withStore('settings', 'readonly', (store) =>
      requestToPromise(store.get(SETTINGS_KEY))
    );

    return sanitizeProviderSettings(record?.value || DEFAULT_PROVIDER_SETTINGS);
  },

  async save(input) {
    const value = validateProviderSettings(input);

    await withStore('settings', 'readwrite', (store) =>
      requestToPromise(
        store.put({
          key: SETTINGS_KEY,
          value,
        })
      )
    );

    return value;
  },

  async clear() {
    await withStore('settings', 'readwrite', (store) =>
      requestToPromise(store.delete(SETTINGS_KEY))
    );

    return sanitizeProviderSettings(DEFAULT_PROVIDER_SETTINGS);
  },
};
