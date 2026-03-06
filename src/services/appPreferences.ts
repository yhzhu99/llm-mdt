import { requestToPromise, withStore } from './browserDb'
import type { AppLocale, AppPreferences } from '@/types'

const APP_PREFERENCES_KEY = 'app_preferences'

interface AppPreferencesRecord {
  key: string
  value: AppPreferences
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  locale: 'zh-CN',
  lastProjectId: null,
  lastConversationId: null,
}

export function sanitizeLocale(value: unknown): AppLocale {
  return value === 'en' ? 'en' : 'zh-CN'
}

function sanitizeOptionalId(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

export function sanitizeAppPreferences(input?: Partial<AppPreferences> | null): AppPreferences {
  return {
    locale: sanitizeLocale(input?.locale),
    lastProjectId: sanitizeOptionalId(input?.lastProjectId),
    lastConversationId: sanitizeOptionalId(input?.lastConversationId),
  }
}

export const appPreferencesStore = {
  async get() {
    const record = await withStore('settings', 'readonly', (store) =>
      requestToPromise(
        (store as IDBObjectStore).get(APP_PREFERENCES_KEY) as IDBRequest<AppPreferencesRecord | undefined>,
      ),
    )

    return sanitizeAppPreferences(record?.value ?? DEFAULT_APP_PREFERENCES)
  },

  async save(input?: Partial<AppPreferences> | null) {
    const existing = await this.get()
    const value = sanitizeAppPreferences({
      ...existing,
      ...(input || {}),
    })

    await withStore('settings', 'readwrite', (store) =>
      requestToPromise(
        (store as IDBObjectStore).put({
          key: APP_PREFERENCES_KEY,
          value,
        }) as IDBRequest<IDBValidKey>,
      ),
    )

    return value
  },
}
