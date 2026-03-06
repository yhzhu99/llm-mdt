import { beforeEach, describe, expect, it } from 'vitest'
import { resetBrowserDb } from './browserDb'
import { conversationStore } from './conversationStore'
import { DEFAULT_PROJECT_ID, projectStore } from './projectStore'

describe('projectStore', () => {
  beforeEach(async () => {
    await resetBrowserDb().catch(() => {})
  })

  it('creates a default project and migrates conversations into projects', async () => {
    const defaultProject = await projectStore.ensureDefaultProject()
    expect(defaultProject.id).toBe(DEFAULT_PROJECT_ID)

    const created = await conversationStore.createConversation('conv-1')
    expect(created.project_id).toBe(DEFAULT_PROJECT_ID)

    const projects = await projectStore.listProjects()
    expect(projects).toEqual([
      expect.objectContaining({
        id: DEFAULT_PROJECT_ID,
        conversation_count: 1,
        is_default: true,
      }),
    ])
  })

  it('deletes a project with its conversations and keeps a usable fallback project', async () => {
    const project = await projectStore.createProject('Project B')
    await conversationStore.createConversationForProject(project.id, {
      conversationId: 'conv-b',
      title: 'Inside B',
    })

    const result = await projectStore.deleteProject(project.id)
    expect(result).toEqual({
      deleted: true,
      nextProjectId: DEFAULT_PROJECT_ID,
    })

    expect(await conversationStore.getConversation('conv-b')).toBeNull()
    expect(await projectStore.listProjects()).toEqual([
      expect.objectContaining({
        id: DEFAULT_PROJECT_ID,
        is_default: true,
      }),
    ])
  })
})
