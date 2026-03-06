import { requestToPromise, withStore } from './browserDb'
import { translate } from '@/i18n'
import type { AppLocale, ProviderSettings, ProviderSettingsInput } from '@/types'

const SETTINGS_KEY = 'provider'

interface SettingsRecord {
  key: string
  value: ProviderSettings
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: '',
  councilModels: ['openai/gpt-5.2', 'google/gemini-3-pro-preview', 'deepseek/deepseek-reasoner'],
  chairmanModel: 'google/gemini-3-pro-preview',
  titleModel: 'google/gemini-3-pro-preview',
}

function uniqueStrings(values: unknown[]) {
  return [...new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

export function normalizeBaseUrl(value: unknown) {
  return String(value ?? '').trim()
}

export function parseModelList(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) {
    return uniqueStrings(value)
  }

  return uniqueStrings(
    String(value ?? '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim()),
  )
}

export function formatModelList(models: string[]) {
  return (models ?? []).join('\n')
}

export function sanitizeProviderSettings(input?: ProviderSettingsInput | null): ProviderSettings {
  const baseUrl = normalizeBaseUrl(input?.baseUrl ?? DEFAULT_PROVIDER_SETTINGS.baseUrl)
  const apiKey = String(input?.apiKey ?? '').trim()
  const councilModels = parseModelList(input?.councilModels ?? DEFAULT_PROVIDER_SETTINGS.councilModels)
  const chairmanModel =
    String(input?.chairmanModel ?? '').trim() || councilModels[0] || DEFAULT_PROVIDER_SETTINGS.chairmanModel
  const titleModel = String(input?.titleModel ?? '').trim() || chairmanModel || DEFAULT_PROVIDER_SETTINGS.titleModel

  return {
    baseUrl,
    apiKey,
    councilModels,
    chairmanModel,
    titleModel,
  }
}

export function validateProviderSettings(input?: ProviderSettingsInput | null, locale: AppLocale = 'zh-CN') {
  const settings = sanitizeProviderSettings(input)

  if (!settings.baseUrl) {
    throw new Error(translate(locale, 'errorSaveBaseUrl'))
  }

  if (!settings.apiKey) {
    throw new Error(translate(locale, 'errorSaveApiKey'))
  }

  if (settings.councilModels.length === 0) {
    throw new Error(translate(locale, 'errorSaveCouncilModels'))
  }

  if (!settings.chairmanModel) {
    throw new Error(translate(locale, 'errorSaveChairmanModel'))
  }

  return settings
}

export function isProviderConfigured(settings?: ProviderSettingsInput | null) {
  const sanitized = sanitizeProviderSettings(settings)
  return Boolean(
    sanitized.baseUrl && sanitized.apiKey && sanitized.councilModels.length > 0 && sanitized.chairmanModel,
  )
}

export const settingsStore = {
  async get() {
    const record = await withStore('settings', 'readonly', (store) =>
      requestToPromise((store as IDBObjectStore).get(SETTINGS_KEY) as IDBRequest<SettingsRecord | undefined>),
    )

    return sanitizeProviderSettings(record?.value ?? DEFAULT_PROVIDER_SETTINGS)
  },

  async save(input?: ProviderSettingsInput | null, locale: AppLocale = 'zh-CN') {
    const value = validateProviderSettings(input, locale)

    await withStore('settings', 'readwrite', (store) =>
      requestToPromise(
        (store as IDBObjectStore).put({
          key: SETTINGS_KEY,
          value,
        }) as IDBRequest<IDBValidKey>,
      ),
    )

    return value
  },

  async clear() {
    await withStore('settings', 'readwrite', (store) =>
      requestToPromise((store as IDBObjectStore).delete(SETTINGS_KEY) as IDBRequest<undefined>),
    )

    return sanitizeProviderSettings(DEFAULT_PROVIDER_SETTINGS)
  },
}
