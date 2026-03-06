import { requestToPromise, withStore } from './browserDb'
import type { PersistedConversationRun } from '@/types'

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

export const conversationRunStore = {
  async list() {
    const runs = await withStore('runs', 'readonly', (store) =>
      requestToPromise((store as IDBObjectStore).getAll() as IDBRequest<PersistedConversationRun[]>),
    )

    return cloneValue(runs || [])
  },

  async get(conversationId: string) {
    const run = await withStore('runs', 'readonly', (store) =>
      requestToPromise(
        (store as IDBObjectStore).get(conversationId) as IDBRequest<PersistedConversationRun | undefined>,
      ),
    )

    return run ? cloneValue(run) : null
  },

  async save(run: PersistedConversationRun) {
    const normalized: PersistedConversationRun = {
      ...cloneValue(run),
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
