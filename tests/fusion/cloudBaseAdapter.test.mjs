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
async function withTransport(run, failure) {
  const db = cloudbase.init({ env: 'local-fixture-only' }).database()
  const original = Db.reqClass
  const committed = new Map()
  const calls = []
  let working
  function seed(kind, payload) {
    committed.set(`${PROBE_COLLECTIONS[kind]}/${documentKey('a')}`, { _id: documentKey('a'), projectId: 'a', payload })
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
      assert.equal(args.transactionId, 'fixture-tx')
      assert.ok(Object.values(PROBE_COLLECTIONS).includes(args.collectionName))
      if (failure?.(api, args)) return { code: 'FIXTURE_DATABASE_FAILURE', message: 'must not become a missing record' }
      const id = EJSON.parse(args.query)._id
      const key = `${args.collectionName}/${id}`
      if (api === 'database.getDocument') return { data: { list: working.has(key) ? [EJSON.stringify(working.get(key))] : [] } }
      if (api === 'database.modifyDocument') {
        working.set(key, { _id: id, ...EJSON.parse(args.data) })
        return { data: { updated: 1, upserted: [] } }
      }
      throw Error(`UNEXPECTED_SDK_API:${api}`)
    }
  }
  try { await run({ store: cloudBaseTransactionStore(db), committed, calls }) }
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
