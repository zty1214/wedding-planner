import { openFieldDraftVault } from './fieldDrafts.ts'
import { openGuestDraftVault } from './guestDrafts.ts'
import { openNoteDraftVault } from './noteDrafts.ts'

/** Read every private form for this project, including deleted entities and old epochs. */
export async function readPrivateDraftInventory(projectId: string, factory: IDBFactory = indexedDB) {
  async function fields() { const v = await openFieldDraftVault(factory); try { return await v.list(projectId) } finally { v.close() } }
  async function guests() { const v = await openGuestDraftVault(factory); try { return await v.list(projectId) } finally { v.close() } }
  async function notes() { const v = await openNoteDraftVault(factory); try { return await v.list(projectId) } finally { v.close() } }
  const [fieldDrafts, guestDrafts, noteDrafts] = await Promise.all([fields(), guests(), notes()])
  return { format: 'planner-private-form-drafts-v1' as const, projectId, exportedAt: new Date().toISOString(), fieldDrafts, guestDrafts, noteDrafts }
}
export type PrivateDraftInventory = Awaited<ReturnType<typeof readPrivateDraftInventory>>
