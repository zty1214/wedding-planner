// Explicitly scoped read adapters. No update/set/delete methods are used.
import { collectBackupSource } from './backup.mjs'
import { TABLES } from '../fusion/inventory.mjs'
const project = value => { if (typeof value !== 'string' || !value) throw Error('EXPLICIT_SOURCE_PROJECT_REQUIRED'); return value }
export async function collectPlannerBackup(client, projectId, metadata = {}) {
  project(projectId)
  return collectBackupSource({ ...metadata, sourceSystem: 'supabase-planner', sourceProjectId: projectId, schema: 'planner-supabase-v1', exportedAt: new Date().toISOString() }, TABLES,
    async (table, offset, size) => {
      const result = await client.from(table).select('*', { count: 'exact' }).eq('project_id', projectId)
        .order(table === 'project_config' ? 'project_id' : 'id').range(offset, offset + size - 1).abortSignal(AbortSignal.timeout(20_000))
      if (result.error) throw Error('SOURCE_READ_FAILED')
      if (!Array.isArray(result.data) || result.data.some(row => row.project_id !== projectId)) throw Error('SOURCE_PROJECT_SCOPE_MISMATCH')
      return { rows: result.data, count: result.count }
    })
}
export async function collectSeatingBackup(db, projectId, metadata = {}) {
  project(projectId)
  return collectBackupSource({ ...metadata, sourceSystem: 'cloudbase-wedding', sourceProjectId: projectId, schema: 'cloudbase-weddings-document-v1', exportedAt: new Date().toISOString() }, ['weddings'],
    async (_collection, offset) => {
      if (offset !== 0) throw Error('UNEXPECTED_SEATING_PAGE')
      const response = await db.collection('weddings').where({ _id: projectId, projectId }).limit(2).get()
      if (!response || response.code || !Array.isArray(response.data)) throw Error('SOURCE_READ_FAILED')
      if (response.data.length !== 1) throw Error('SOURCE_DOCUMENT_REQUIRED')
      const row = response.data[0]
      if (row._id !== projectId || row.projectId !== projectId || row.schemaVersion !== 1 || !row.wedding
        || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt) || row.wedding.updatedAt !== row.updatedAt) throw Error('SOURCE_PROJECT_OR_VERSION_MISMATCH')
      return { rows: response.data, count: 1 }
    })
}
