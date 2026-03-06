import { requestToPromise, withStore } from './browserDb'
import type { Conversation, Project, ProjectSummary } from '@/types'

export const DEFAULT_PROJECT_ID = 'project_default'
export const DEFAULT_PROJECT_NAME = '默认项目'

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function createDefaultProject(): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    name: DEFAULT_PROJECT_NAME,
    created_at: new Date().toISOString(),
    is_default: true,
  }
}

function normalizeProject(project: Project): Project {
  return {
    ...cloneValue(project),
    name: String(project.name ?? '').trim() || DEFAULT_PROJECT_NAME,
    created_at: String(project.created_at ?? '') || new Date().toISOString(),
    is_default: Boolean(project.is_default),
  }
}

function sortProjects(projects: ProjectSummary[]) {
  return [...projects].sort(
    (left, right) =>
      Number(Boolean(right.is_default)) - Number(Boolean(left.is_default)) ||
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )
}

function asProjectStores(stores: unknown) {
  return stores as Record<'projects' | 'conversations', IDBObjectStore>
}

function syncConversationProjects(
  store: IDBObjectStore,
  validProjectIds: Set<string>,
  fallbackProjectId: string,
) {
  return new Promise<void>((resolve, reject) => {
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }

      const value = cursor.value as Conversation
      if (!value.project_id || !validProjectIds.has(value.project_id)) {
        cursor.update({
          ...value,
          project_id: fallbackProjectId,
        })
      }
      cursor.continue()
    }

    request.onerror = () => reject(request.error ?? new Error('Failed to migrate conversation projects'))
  })
}

function deleteConversationsInProject(store: IDBObjectStore, projectId: string) {
  return new Promise<void>((resolve, reject) => {
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }

      const value = cursor.value as Conversation
      if (value.project_id === projectId) {
        cursor.delete()
      }
      cursor.continue()
    }

    request.onerror = () => reject(request.error ?? new Error('Failed to delete project conversations'))
  })
}

async function ensureProjectIntegrity() {
  return withStore(['projects', 'conversations'], 'readwrite', async (stores) => {
    const { projects: projectStore, conversations: conversationStore } = asProjectStores(stores)

    const rawProjects = await requestToPromise(projectStore.getAll() as IDBRequest<Project[]>)
    let projects = rawProjects.map(normalizeProject)

    if (projects.length === 0) {
      const defaultProject = createDefaultProject()
      await requestToPromise(projectStore.put(defaultProject) as IDBRequest<IDBValidKey>)
      projects = [defaultProject]
    }

    const chosenDefault =
      projects.find((project) => project.is_default) ||
      projects.find((project) => project.id === DEFAULT_PROJECT_ID) ||
      projects[0]!

    projects = projects.map((project) => {
      const nextProject = {
        ...project,
        is_default: project.id === chosenDefault.id,
      }

      if (
        nextProject.is_default !== Boolean(project.is_default) ||
        nextProject.name !== project.name ||
        nextProject.created_at !== project.created_at
      ) {
        projectStore.put(nextProject)
      }

      return nextProject
    })

    await syncConversationProjects(
      conversationStore,
      new Set(projects.map((project) => project.id)),
      chosenDefault.id,
    )

    return cloneValue(projects.find((project) => project.id === chosenDefault.id)!)
  })
}

export const projectStore = {
  async ensureDefaultProject() {
    return ensureProjectIntegrity()
  },

  async listProjects() {
    await ensureProjectIntegrity()

    return withStore(['projects', 'conversations'], 'readonly', async (stores) => {
      const { projects: projectObjectStore, conversations: conversationObjectStore } =
        asProjectStores(stores)
      const [projects, conversations] = await Promise.all([
        requestToPromise(projectObjectStore.getAll() as IDBRequest<Project[]>),
        requestToPromise(conversationObjectStore.getAll() as IDBRequest<Conversation[]>),
      ])

      const counts = conversations.reduce<Record<string, number>>((result, conversation) => {
        const projectId = conversation.project_id || DEFAULT_PROJECT_ID
        result[projectId] = (result[projectId] || 0) + 1
        return result
      }, {})

      return sortProjects(
        projects.map((project) => ({
          id: project.id,
          name: project.name,
          created_at: project.created_at,
          conversation_count: counts[project.id] || 0,
          is_default: Boolean(project.is_default),
        })),
      )
    })
  },

  async createProject(name: string, projectId = createId('project')) {
    await ensureProjectIntegrity()

    const project: Project = {
      id: projectId,
      name: String(name || '').trim() || '新项目',
      created_at: new Date().toISOString(),
      is_default: false,
    }

    await withStore('projects', 'readwrite', (store) =>
      requestToPromise((store as IDBObjectStore).put(project) as IDBRequest<IDBValidKey>),
    )

    return cloneValue(project)
  },

  async renameProject(projectId: string, name: string) {
    await ensureProjectIntegrity()

    return withStore('projects', 'readwrite', async (store) => {
      const objectStore = store as IDBObjectStore
      const existing = await requestToPromise(objectStore.get(projectId) as IDBRequest<Project | undefined>)
      if (!existing) {
        throw new Error(`Project ${projectId} not found`)
      }

      const nextProject: Project = {
        ...normalizeProject(existing),
        name: String(name || '').trim() || existing.name,
      }

      await requestToPromise(objectStore.put(nextProject) as IDBRequest<IDBValidKey>)
      return cloneValue(nextProject)
    })
  },

  async deleteProject(projectId: string) {
    await ensureProjectIntegrity()

    return withStore(['projects', 'conversations'], 'readwrite', async (stores) => {
      const { projects: projectObjectStore, conversations: conversationObjectStore } =
        asProjectStores(stores)
      const rawProjects = await requestToPromise(projectObjectStore.getAll() as IDBRequest<Project[]>)
      const projects = rawProjects.map(normalizeProject)
      const target = projects.find((project) => project.id === projectId)

      if (!target) {
        const fallbackProject = projects.find((project) => project.is_default) || projects[0] || createDefaultProject()
        return { deleted: false, nextProjectId: fallbackProject.id }
      }

      await deleteConversationsInProject(conversationObjectStore, projectId)
      await requestToPromise(projectObjectStore.delete(projectId) as IDBRequest<undefined>)

      const remainingProjects = projects.filter((project) => project.id !== projectId)

      if (remainingProjects.length === 0) {
        const defaultProject = createDefaultProject()
        await requestToPromise(projectObjectStore.put(defaultProject) as IDBRequest<IDBValidKey>)
        return { deleted: true, nextProjectId: defaultProject.id }
      }

      const nextDefault =
        !target.is_default
          ? remainingProjects.find((project) => project.is_default) || remainingProjects[0]!
          : remainingProjects[0]!

      await Promise.all(
        remainingProjects.map((project) =>
          requestToPromise(
            projectObjectStore.put({
              ...project,
              is_default: project.id === nextDefault.id,
            }) as IDBRequest<IDBValidKey>,
          ),
        ),
      )

      return { deleted: true, nextProjectId: nextDefault.id }
    })
  },
}
