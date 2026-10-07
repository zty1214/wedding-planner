import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import type { Exclusive } from '../../src/fusion/repository.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'
const exclusive: Exclusive = async (_key, body) => body()
function setup() {
  const store = new MemoryStore(), secret = 'b'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a']); let offline = false
  return { store, setOffline: (value: boolean) => { offline = value }, transport: gatewayTransport('a', secret, async e => { if (offline) throw Error('OFFLINE'); return gateway(e) }) }
}
test('confirmed baseline survives reopen, stays separate from optimistic drafts and is never offline authorization', async () => {
  const factory = new IDBFactory(), { transport, setOffline } = setup()
  let storage = await openIndexedDbOutbox(factory), repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  const baseline = await storage.readConfirmed!('a')
  assert.ok(baseline); assert.equal(baseline.snapshot.role, undefined)
  assert.equal(await storage.readConfirmed!('b'), undefined)
  setOffline(true); await repo.dispatch('guest.add', { id: 'g', name: '仅草稿', group: '' }, {})
  assert.deepEqual(await storage.readConfirmed!('a'), baseline)
  repo.stop(); storage.close(); storage = await openIndexedDbOutbox(factory); repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); assert.equal(repo.getSnapshot().snapshot, null)
  await assert.rejects(repo.readDraftBase(), /OFFLINE/)
  assert.deepEqual(await storage.readConfirmed!('a'), baseline)
  setOffline(false); await repo.open()
  assert.deepEqual(await repo.readDraftBase(), baseline)
  assert.equal(repo.getSnapshot().status, 'resume_required')
  await repo.resume()
  assert.equal((await storage.readConfirmed!('a'))!.snapshot.data.guests.g.name, '仅草稿')
  repo.stop(); storage.close()
})
test('revocation removes shared cache but preserves original private intents', async () => {
  const { transport, store, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true); await repo.dispatch('guest.add', { id: 'g', name: '保留草稿', group: '' }, {})
  const drafts = await repo.readDrafts()
  store.projects.get('a')!.access.collaborationHash = hashSecret('revoked'); setOffline(false)
  await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'forbidden')
  assert.equal(await storage.readConfirmed!('a'), undefined)
  assert.deepEqual((await repo.readDrafts()).map(d => d.command), drafts.map(d => d.command))
  await assert.rejects(repo.readDraftBase(), { code: 'FORBIDDEN' })
  repo.stop(); storage.close()
})
test('restored epoch cannot expose an old cache as its own reference', async () => {
  const { transport, store, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true); await repo.dispatch('guest.add', { id: 'g', name: '旧代次', group: '' }, {})
  store.projects.get('a')!.current.dataEpoch = 'new'; setOffline(false)
  assert.equal(await repo.readDraftBase(), null)
  assert.equal((await repo.readDrafts())[0].command.dataEpoch, 'e')
  repo.stop(); storage.close()
})
test('cache write failure is reported independently of a successful cloud read', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', { ...storage, saveConfirmed: async () => { throw Error('QUOTA') } }, transport, exclusive)
  await repo.open()
  assert.equal(repo.getSnapshot().status, 'synced'); assert.equal(repo.getSnapshot().cacheError, 'CACHE_WRITE_FAILED')
  assert.equal(repo.captureExport().snapshot.data.config.title, '备婚助手')
  repo.stop(); storage.close()
})
test('version 1 outbox upgrade preserves existing commands and adds an empty cache', async () => {
  const factory = new IDBFactory(), command = { projectId: 'a', dataEpoch: 'e', operationId: 'old', commandVersion: 1, type: 'guest.add', payload: { id: 'g', name: '升级前', group: '' }, expectedRevisions: {} }
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('wedding-planner-fusion-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('outbox')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('outbox', 'readwrite')
      tx.objectStore('outbox').put({ command, status: 'prepared', sequence: 1 }, ['a', 'e', 'old'])
      tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => reject(tx.error)
    }
  })
  const storage = await openIndexedDbOutbox(factory)
  assert.deepEqual((await storage.list('a'))[0].command, command)
  assert.equal(await storage.readConfirmed!('a'), undefined); storage.close()
})

test('pending queue pins old baseline while latest confirmed copy advances, then releases it after resolution', async () => {
  const { transport, store, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); const baseline = await storage.readConfirmed!('a')
  setOffline(true); await repo.dispatch('guest.add', { id: 'g', name: '本机新增', group: '' }, {})
  repo.stop(); setOffline(false)
  const changed = emptyCore(); changed.config.title = '另一端新标题'
  store.projects.get('a')!.current.data = changed
  store.projects.get('a')!.current.snapshotRevision = 1
  repo = projectRepository('a', storage, transport, exclusive); await repo.open()
  assert.equal((await storage.readConfirmed!('a'))!.snapshot.data.config.title, '另一端新标题')
  assert.deepEqual(await repo.readDraftBase(), baseline)
  await repo.resume()
  assert.equal((await storage.readDraftBaseline!('a'))!.snapshot.data.guests.g.name, '本机新增')
  repo.stop(); storage.close()
})

test('failed cache purge never restores display or authorization, and successful purge stays project-scoped', async () => {
  const { transport, store } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  await storage.saveConfirmed!({ projectId: 'b', capturedAt: new Date().toISOString(), snapshot: { dataEpoch: 'b-e', snapshotRevision: 0, data: emptyCore() } })
  const repo = projectRepository('a', { ...storage, clearConfirmed: async () => { throw Error('DISK') } }, transport, exclusive)
  await repo.open(); store.projects.get('a')!.access.collaborationHash = hashSecret('revoked'); await repo.refresh()
  assert.equal(repo.getSnapshot().cacheError, 'CACHE_CLEAR_FAILED')
  assert.equal(repo.getSnapshot().snapshot, null)
  assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/)
  await assert.rejects(repo.readDraftBase(), { code: 'FORBIDDEN' })
  await storage.clearConfirmed!('a')
  assert.equal(await storage.readConfirmed!('a'), undefined)
  assert.equal((await storage.readConfirmed!('b'))!.projectId, 'b')
  repo.stop(); storage.close()
})
