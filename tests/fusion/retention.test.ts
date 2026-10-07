import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { pruneExpired, runRetentionBatch } from '../../server/fusion/retention.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import { activityService } from '../../server/fusion/activityService.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import type { ProjectVersion } from '../../src/fusion/history.ts'
const start = '2026-01-01T00:00:00.000Z'
const end = new Date(Date.parse(start) + 90 * 86400000)
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('admin') }, { dataEpoch: 'current', snapshotRevision: 0, data: emptyCore() })
  const version: ProjectVersion = { id: 'v', name: '每日', kind: 'daily', status: 'ready', dataEpoch: 'old', snapshotRevision: 0, notesRevision: 0, capturedAt: start, lastBusinessCommittedAt: start, businessDate: '2026-01-01', expiresAt: end.toISOString(), counts: { guests: 0, tables: 0, rooms: 0, notes: 0 }, schemaVersion: 1, core: emptyCore(), notes: [], noteRetiredIds: [] }
  const project = store.projects.get('a')!
  project.versions.set('v', version)
  const { core: _core, notes: _notes, noteRetiredIds: _retired, schemaVersion: _schema, ...meta } = version
  project.history.push(meta)
  return { store, version }
}
const candidate = { projectId: 'a', id: 'v', kind: 'version' as const, dataEpoch: 'old' }
test('retention boundary deletes only expired body, preserves calendar metadata, manual versions and live state', async () => {
  const { store, version } = setup()
  const before = structuredClone(store.projects.get('a')!)
  assert.equal(await pruneExpired(store, candidate, new Date(+end - 1)), 'protected')
  assert.equal(await pruneExpired(store, { ...candidate, dataEpoch: 'wrong' }, end), 'protected')
  await assert.rejects(historyService(store, () => end).read('a', 'secret', 'v'), { code: 'NOT_FOUND' })
  assert.equal(await pruneExpired(store, candidate, end), 'removed')
  assert.equal(await pruneExpired(store, candidate, end), 'missing')
  const p = store.projects.get('a')!
  assert.deepEqual(p.current, before.current); assert.deepEqual(p.receipts, before.receipts); assert.deepEqual(p.access, before.access)
  assert.deepEqual(p.history, before.history)
  const month = await activityService(store, () => end).month('a', 'secret', '2026-01')
  assert.equal(month.days[0].snapshot, 'expired')
  store.projects.get('a')!.versions.set('v', { ...version, kind: 'manual', expiresAt: null })
  assert.equal(await pruneExpired(store, candidate, end), 'protected')
})
test('expired recycle cleanup removes old epoch index entry and rolls back on index failure', async () => {
  const { store } = setup()
  const p = store.projects.get('a')!
  p.recycled.set(JSON.stringify(['old', 'r']), { id: 'r', dataEpoch: 'old', type: 'guest.delete', createdAt: start, expiresAt: new Date(Date.parse(start) + 30 * 86400000).toISOString(), restoredAt: null, changes: [] })
  p.recycleIndexes.set('old', ['r', 'another'])
  const c = { projectId: 'a', id: 'r', kind: 'recycle' as const, dataEpoch: 'old' }
  const before = structuredClone(p)
  const failing = { run: <T>(id: string, body: Parameters<MemoryStore['run']>[1]) => store.run(id, tx => body({ ...tx, putRecycleIndex: async () => { throw Error('FAIL') } })) as Promise<T> }
  await assert.rejects(pruneExpired(failing, c, end))
  assert.deepEqual(store.projects.get('a'), before)
  assert.equal(await pruneExpired(store, c, end), 'removed')
  assert.deepEqual(store.projects.get('a')!.recycleIndexes.get('old'), ['another'])
})
test('batch stays bounded, advances past failures and later retries without deleting unapproved projects', async () => {
  const { store } = setup()
  let cursor: string | null = null
  const rows = [{ key: '1', candidate: { ...candidate, projectId: 'not-approved' } }, { key: '2', candidate }]
  const source = { cursor: async () => cursor, list: async (after: string | null, limit: number) => rows.filter(r => after === null || r.key > after).slice(0, limit), checkpoint: async (value: string | null) => { cursor = value } }
  const failing = { run: async <T>(): Promise<T> => { throw Error('UNAVAILABLE') } }
  assert.deepEqual(await runRetentionBatch(failing, source, id => id === 'a', end), { removed: 0, skipped: 1, failed: 1, batchLimit: 20 })
  assert.equal(cursor, '2')
  assert.equal((await runRetentionBatch(store, source, id => id === 'a', end)).removed, 1)
  await assert.rejects(runRetentionBatch(store, source, () => true, end, 21), /INVALID_RETENTION_LIMIT/)
})

test('expiry scan skips matching history-index arrays while advancing the bounded cursor', async () => {
  const { retentionScanRow } = await import('../../server/fusion/retention.ts')
  const { store } = setup()
  const rows = [retentionScanRow({ _id: '1', projectId: 'a', payload: [{ id: 'v', kind: 'daily', dataEpoch: 'old' }] }),
    retentionScanRow({ _id: '2', projectId: 'a', payload: { id: 'v', kind: 'daily', dataEpoch: 'old' } }),
    retentionScanRow({ _id: '3', projectId: 'a', payload: { id: 'not-a-body', dataEpoch: 'old' } })]
  assert.equal(rows[0].candidate, null); assert.equal(rows[2].candidate, null)
  assert.equal(retentionScanRow({ _id: 'r', projectId: 'a', payload: { id: 'r', dataEpoch: 'old', type: 'guest.delete' } }).candidate?.kind, 'recycle')
  let cursor: string | null = null
  const source = { cursor: async () => cursor, list: async () => rows, checkpoint: async (value: string | null) => { cursor = value } }
  assert.deepEqual(await runRetentionBatch(store, source, id => id === 'a', end), { removed: 1, skipped: 2, failed: 0, batchLimit: 20 })
  assert.equal(cursor, '3'); assert.equal(store.projects.get('a')!.history.length, 1)
})
