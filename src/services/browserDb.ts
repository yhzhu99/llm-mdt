const DB_NAME = 'llm-mdt'
const DB_VERSION = 3

let dbPromise: Promise<IDBDatabase> | null = null

export type BrowserStoreName = 'conversations' | 'settings' | 'projects' | 'runs'
export type BrowserStoreSelection = IDBObjectStore | Record<BrowserStoreName, IDBObjectStore>

function createError(message: string) {
  return new Error(message)
}

export function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? createError('IndexedDB request failed'))
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? createError('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? createError('IndexedDB transaction failed'))
  })
}

export function openBrowserDb() {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(createError('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const transaction = request.transaction
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }

      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('runs')) {
        db.createObjectStore('runs', { keyPath: 'conversationId' })
      }

      if (oldVersion < 2 && transaction && db.objectStoreNames.contains('conversations')) {
        const projectsStore = transaction.objectStore('projects')
        const conversationsStore = transaction.objectStore('conversations')
        const defaultProjectId = 'project_default'

        projectsStore.put({
          id: defaultProjectId,
          name: '默认项目',
          created_at: new Date().toISOString(),
          is_default: true,
        })

        const cursorRequest = conversationsStore.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return

          const value = cursor.value as Record<string, unknown>
          if (!value.project_id) {
            cursor.update({
              ...value,
              project_id: defaultProjectId,
            })
          }
          cursor.continue()
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? createError('Failed to open IndexedDB'))
  })

  return dbPromise
}

export async function withStore<TResult>(
  storeNames: BrowserStoreName | BrowserStoreName[],
  mode: IDBTransactionMode,
  handler: (stores: BrowserStoreSelection, transaction: IDBTransaction) => TResult | Promise<TResult>,
): Promise<TResult> {
  const db = await openBrowserDb()
  const names = Array.isArray(storeNames) ? [...storeNames] : [storeNames]
  const transaction = db.transaction(names, mode)
  const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)])) as Record<
    BrowserStoreName,
    IDBObjectStore
  >
  const selectedStores = Array.isArray(storeNames) ? stores : stores[storeNames]
  const result = await handler(selectedStores, transaction)
  await transactionToPromise(transaction)
  return result
}

export async function resetBrowserDb() {
  const db = await openBrowserDb().catch(() => null)
  if (db) {
    db.close()
  }
  dbPromise = null

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? createError('Failed to delete IndexedDB'))
    request.onblocked = () => reject(createError('Failed to delete IndexedDB: database is blocked'))
  })
}
