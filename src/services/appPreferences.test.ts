import { beforeEach, describe, expect, it } from 'vitest'
import { appPreferencesStore } from './appPreferences'
import { resetBrowserDb } from './browserDb'

describe('appPreferencesStore', () => {
  beforeEach(async () => {
    await resetBrowserDb().catch(() => {})
  })

  it('defaults to chinese and persists locale changes', async () => {
    expect(await appPreferencesStore.get()).toEqual({ locale: 'zh-CN' })

    await appPreferencesStore.save({ locale: 'en' })
    expect(await appPreferencesStore.get()).toEqual({ locale: 'en' })
  })
})
