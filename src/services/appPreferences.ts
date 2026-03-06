import { requestToPromise, withStore } from './browserDb'
import type { AppLocale, AppPreferences } from '@/types'

const APP_PREFERENCES_KEY = 'app_preferences'

interface AppPreferencesRecord {
  key: string
  value: AppPreferences
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  locale: 'zh-CN',
}

export function sanitizeLocale(value: unknown): AppLocale {
  return value === 'en' ? 'en' : 'zh-CN'
}

export function sanitizeAppPreferences(input?: Partial<AppPreferences> | null): AppPreferences {
  return {
    locale: sanitizeLocale(input?.locale),
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
    const value = sanitizeAppPreferences(input)

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
