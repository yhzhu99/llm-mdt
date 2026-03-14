import { requestToPromise, withStore } from './browserDb'
import type { PersistedConversationRun } from '@/types'
import { normalizeUserInputPayload } from '@/utils/attachments'

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

export const conversationRunStore = {
  async list() {
    const runs = await withStore('runs', 'readonly', (store) =>
      requestToPromise((store as IDBObjectStore).getAll() as IDBRequest<Array<PersistedConversationRun | Record<string, unknown>>>),
    )

    return cloneValue(
      (runs || []).map((run) => normalizeRun(run)).filter((run): run is PersistedConversationRun => Boolean(run)),
    )
  },

  async get(conversationId: string) {
    const run = await withStore('runs', 'readonly', (store) =>
      requestToPromise(
        (store as IDBObjectStore).get(conversationId) as IDBRequest<PersistedConversationRun | Record<string, unknown> | undefined>,
      ),
    )

    const normalizedRun = normalizeRun(run)
    return normalizedRun ? cloneValue(normalizedRun) : null
  },

  async save(run: PersistedConversationRun) {
    const normalized: PersistedConversationRun = {
      ...cloneValue(run),
      input: normalizeUserInputPayload(run.input),
      updatedAt: String(run.updatedAt || '') || new Date().toISOString(),
      startedAt: String(run.startedAt || '') || new Date().toISOString(),
      stage: run.stage || 'stage1',
      status: run.status || 'running',
    }

    await withStore('runs', 'readwrite', (store) =>
      requestToPromise((store as IDBObjectStore).put(normalized) as IDBRequest<IDBValidKey>),
    )

    return cloneValue(normalized)
  },

  async delete(conversationId: string) {
    await withStore('runs', 'readwrite', (store) =>
      requestToPromise((store as IDBObjectStore).delete(conversationId) as IDBRequest<undefined>),
    )
  },

  async deleteByProject(projectId: string) {
    await withStore('runs', 'readwrite', (store) => {
      const objectStore = store as IDBObjectStore

      return new Promise<void>((resolve, reject) => {
        const request = objectStore.openCursor()

        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }

          const value = cursor.value as PersistedConversationRun
          if (value.projectId === projectId) {
            cursor.delete()
          }
          cursor.continue()
        }

        request.onerror = () => reject(request.error ?? new Error('Failed to delete conversation runs'))
      })
    })
  },
}

function normalizeRun(run: PersistedConversationRun | Record<string, unknown> | null | undefined): PersistedConversationRun | null {
  if (!run || typeof run !== 'object') return null

  const record = run as Record<string, unknown>

  return {
    conversationId: String(record.conversationId || ''),
    projectId: String(record.projectId || ''),
    requestId: String(record.requestId || ''),
    assistantMessageId: String(record.assistantMessageId || ''),
    userMessageId: String(record.userMessageId || ''),
    input: normalizeUserInputPayload(record.input ?? record.content ?? ''),
    locale: (record.locale === 'en' ? 'en' : 'zh-CN'),
    runConfig: (record.runConfig as PersistedConversationRun['runConfig']) || undefined,
    shouldGenerateTitle: Boolean(record.shouldGenerateTitle),
    startedAt: String(record.startedAt || '') || new Date().toISOString(),
    updatedAt: String(record.updatedAt || '') || new Date().toISOString(),
    stage: (record.stage as PersistedConversationRun['stage']) || 'stage1',
    status: (record.status as PersistedConversationRun['status']) || 'running',
    lastError: typeof record.lastError === 'string' ? record.lastError : '',
  }
}
