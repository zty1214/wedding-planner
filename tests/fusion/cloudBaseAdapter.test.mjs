import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import cloudbase from '@cloudbase/node-sdk'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
const require = createRequire(import.meta.url)
const { Db } = require('@cloudbase/database')
const { EJSON } = createRequire(require.resolve('@cloudbase/database'))('bson')

// Actual installed SDK serialization/transaction machinery; only its HTTP requester is replaced.
// This checks the SDK boundary, not the remote service or security rules.
async function withTransport(run, failure, collections = PROBE_COLLECTIONS, projectId = 'a') {
  const db = cloudbase.init({ env: 'local-fixture-only' }).database()
  const original = Db.reqClass
  const committed = new Map()
  const calls = []
  let working
  function seed(kind, payload) {
    committed.set(`${collections[kind]}/${documentKey(projectId)}`, { _id: documentKey(projectId), projectId, payload })
  }
  seed('access', { collaborationHash: hashSecret('collab-fixture'), managementHash: hashSecret('manager-fixture') })
  seed('current', { dataEpoch: 'e1', snapshotRevision: 0, data: 0 })
  Db.reqClass = class {
    async send(api, args = {}) {
      calls.push(api)
      if (api === 'database.startTransaction') { working = structuredClone(committed); return { transactionId: 'fixture-tx' } }
      if (api === 'database.abortTransaction') { working = null; return {} }
      if (api === 'database.commitTransaction') {
        committed.clear(); for (const [k, v] of working) committed.set(k, v)
        return {}
      }
      if (!args.transactionId && ['database.getDocument', 'database.calculateDocument'].includes(api)) {
        const query = typeof args.query === 'string' ? EJSON.parse(args.query) : args.query, matches = [...committed.entries()].filter(([k, v]) => k.startsWith(args.collectionName + '/') && v.projectId === query.projectId).map(([, v]) => v).sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
        if (api === 'database.calculateDocument') return { data: { total: matches.length } }
        return { data: { list: matches.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 100)).map(v => EJSON.stringify(v)) } }
      }
      assert.equal(args.transactionId, 'fixture-tx')
      assert.ok(Object.values(collections).includes(args.collectionName))
      if (failure?.(api, args)) return { code: 'FIXTURE_DATABASE_FAILURE', message: 'must not become a missing record' }
      const id = EJSON.parse(args.query)._id
      const key = `${args.collectionName}/${id}`
      if (api === 'database.getDocument') return { data: { list: working.has(key) ? [EJSON.stringify(working.get(key))] : [] } }
      if (api === 'database.removeDocument') {
        const deleted = Number(working.delete(key))
        return { data: { deleted } }
      }
      if (api === 'database.modifyDocument') {
        working.set(key, { _id: id, ...EJSON.parse(args.data) })
        return { data: { updated: 1, upserted: [] } }
      }
      throw Error(`UNEXPECTED_SDK_API:${api}`)
    }
  }
  try { await run({ store: cloudBaseTransactionStore(db, collections), db, committed, calls }) }
  finally { Db.reqClass = original }
}
const command = { projectId: 'a', dataEpoch: 'e1', operationId: 'o1', commandVersion: 1, type: 'increment', payload: null, expectedRevisions: {} }
const serviceFor = store => commandService(store, new Map([['increment', { apply: value => value + 1 }]]))
test('installed CloudBase SDK adapter returns receipts and separates scoped collections', async () => {
  await withTransport(async ({ store, committed, calls }) => {
    const service = serviceFor(store)
    const first = await service.execute(command, 'collab-fixture')
    assert.equal(first.snapshotRevision, 1)
    assert.deepEqual(await service.execute(command, 'collab-fixture'), first)
    assert.equal(committed.size, 4)
    assert.equal(calls.filter(api => api === 'database.commitTransaction').length, 2)
    assert.deepEqual(await service.queryReceipt('a', 'e1', 'o1', 'collab-fixture'), first)
  })
})
test('SDK code-valued read failures are errors, never interpreted as missing documents', async () => {
  await withTransport(async ({ store, committed, calls }) => {
    await assert.rejects(serviceFor(store).execute(command, 'collab-fixture'), { code: 'FIXTURE_DATABASE_FAILURE' })
    assert.equal(committed.size, 2)
    assert.ok(calls.includes('database.abortTransaction'))
    assert.ok(!calls.includes('database.commitTransaction'))
  }, api => api === 'database.getDocument')
})
test('receipt write failure aborts actual SDK transaction including prior business write', async () => {
  await withTransport(async ({ store, committed, calls }) => {
    await assert.rejects(serviceFor(store).execute(command, 'collab-fixture'), { code: 'FIXTURE_DATABASE_FAILURE' })
    assert.equal(committed.get(`${PROBE_COLLECTIONS.current}/${documentKey('a')}`).payload.data, 0)
    assert.equal(committed.size, 2)
    assert.ok(calls.includes('database.abortTransaction'))
  }, (api, args) => api === 'database.modifyDocument' && args.collectionName === PROBE_COLLECTIONS.receipts)
})

test('SDK persists note tombstones and retirement across transactions', async () => {
  const { emptyCore } = await import('../../src/fusion/core.ts')
  const { noteService } = await import('../../server/fusion/noteService.ts')
  const { recycleService } = await import('../../server/fusion/recycleService.ts')
  await withTransport(async ({ store }) => {
    await store.run('a', tx => tx.putCurrent({ dataEpoch: 'e1', snapshotRevision: 0, data: emptyCore() }))
    const notes = noteService(store), recycle = recycleService(store)
    const payload = { id: 'n', category: '酒店', title: '测试', content: '正文' }
    await notes.execute({ ...command, type: 'note.add', payload }, 'collab-fixture')
    await recycle.execute({ ...command, operationId: 'delete', type: 'note.delete', payload: { id: 'n' }, expectedRevisions: { 'note:n': 0 } }, 'collab-fixture')
    assert.deepEqual((await notes.read('a', 'collab-fixture')).notes, [])
    await assert.rejects(notes.execute({ ...command, operationId: 'reuse', type: 'note.add', payload }, 'collab-fixture'), { code: 'CONFLICT' })
    await recycle.execute({ ...command, operationId: 'restore', type: 'recycle.restore', payload: { id: 'delete' } }, 'collab-fixture')
    const result = await notes.read('a', 'collab-fixture')
    assert.equal(result.notes[0].content, '正文'); assert.equal(result.notes[0].revision, 1)
  })
})


test('SDK retention deletion is transactional and scoped to version or recycle body keys', async () => {
  await withTransport(async ({ store, committed, calls }) => {
    const key = `${PROBE_COLLECTIONS.current}/${documentKey('a', 'version', 'expired')}`
    committed.set(key, { projectId: 'a', payload: { fixture: true } })
    await store.run('a', tx => tx.removeVersion('expired'))
    assert.equal(committed.has(key), false)
    assert.equal(committed.size, 2)
    assert.ok(calls.includes('database.removeDocument'))
    const recycleKey = `${PROBE_COLLECTIONS.current}/${documentKey('a', 'recycle', 'old', 'r')}`
    committed.set(recycleKey, { projectId: 'a', payload: { fixture: true } })
    await assert.rejects(store.run('a', async tx => { await tx.removeRecycle('old', 'r'); throw Error('ROLLBACK') }))
    assert.equal(committed.has(recycleKey), true)
    assert.equal(committed.size, 3)
  })
})

test('SDK access decoder preserves credential revision across transactions', async () => {
  await withTransport(async ({ store }) => {
    await store.run('a', async tx => { const access = await tx.access(); await tx.putAccess({ ...access, revision: 3 }) })
    assert.equal(await store.run('a', async tx => (await tx.access()).revision), 3)
  })
})

test('installed SDK keeps explicit business collections separate from the original probe namespace', async () => {
  const collections = Object.fromEntries(Object.keys(PROBE_COLLECTIONS).map(k => [k, 'fictional_business_' + k]))
  await withTransport(async ({ store, committed }) => {
    await serviceFor(store).execute(command, 'collab-fixture')
    assert.ok([...committed.keys()].every(key => key.startsWith('fictional_business_')))
    assert.equal(committed.get(collections.current + '/' + documentKey('a')).payload.data, 1)
  }, undefined, collections)
  const db = cloudbase.init({ env: 'local-fixture-only' }).database()
  assert.throws(() => cloudBaseTransactionStore(db, { ...collections, access: collections.current }), /INVALID_FUSION_COLLECTIONS/)
  assert.throws(() => cloudBaseTransactionStore(db, { extra: 'x', current: 'y', receipts: 'z', activity: 'a' }), /INVALID_FUSION_COLLECTIONS/)
})

test('installed SDK restores project documents with permission roots withheld until verified atomic publication', async () => {
  const { cloudBaseRecoveryStore, recoverFusionProject } = await import('../../scripts/migration/fusion-recovery.mjs'), { collectBackupSource, sealBackup } = await import('../../scripts/migration/backup.mjs'), { randomBytes } = await import('node:crypto'), { emptyCore } = await import('../../src/fusion/core.ts')
  const projectId = 'fusion-created-00000000-0000-4000-8000-000000000001', id = documentKey(projectId), collections = Object.fromEntries(Object.keys(PROBE_COLLECTIONS).map(k => [k, 'planner_fusion_sdk_' + k]))
  const source = { access: [{ _id: id, projectId, payload: { managementHash: 'a'.repeat(64), collaborationHash: 'b'.repeat(64) } }], current: [{ _id: id, projectId, payload: { dataEpoch: 'original-epoch', snapshotRevision: 7, data: emptyCore() } }], receipts: [], activity: [] }
  const b = await collectBackupSource({ sourceSystem: 'fusion-project', sourceEnvironmentId: 'fictional-source', sourceProjectId: projectId, schema: 'fusion-project-documents-v1', exportedAt: '2026-10-08T00:00:00Z' }, Object.keys(source), async (kind, offset) => ({ rows: source[kind].slice(offset), count: source[kind].length })), key = randomBytes(32), envelope = sealBackup(b.rawJson, b.manifest, key)
  await withTransport(async ({ db, committed }) => {
    committed.clear()
    const store = cloudBaseRecoveryStore(db, collections), target = { environmentId: 'local-fixture-only', sourceEnvironmentId: 'fictional-source', isolated: true, batchId: 'fictional-sdk-recovery' }
    for (const action of ['prepare', 'import', 'verify']) await recoverFusionProject(store, envelope, key, target, action)
    assert.equal(committed.has(collections.access + '/' + id), false)
    await recoverFusionProject(store, envelope, key, target, 'publish')
    assert.deepEqual(committed.get(collections.access + '/' + id), source.access[0]); assert.deepEqual(committed.get(collections.current + '/' + id), source.current[0])
  }, undefined, collections, projectId)
})
