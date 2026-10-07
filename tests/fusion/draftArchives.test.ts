import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import type { Pending } from '../../src/fusion/outbox.ts'
const draft = (projectId = 'a'): Pending => ({ status: 'conflict', command: { projectId, dataEpoch: 'e', operationId: 'original', commandVersion: 1, type: 'guest.add', payload: { id: 'g', name: '原始意图', group: '' }, expectedRevisions: {} } })
test('retaining a reviewed batch atomically removes only that project queue and survives reopen', async () => {
  const factory = new IDBFactory(); let storage = await openIndexedDbOutbox(factory)
  try {
    await storage.insert(draft()); await storage.insert(draft('b'))
    const original = await storage.list('a')
    await storage.archiveBatch!('a', original)
    assert.deepEqual(await storage.list('a'), []); assert.equal((await storage.list('b')).length, 1)
    storage.close(); storage = await openIndexedDbOutbox(factory)
    const retained = await storage.listArchives!('a')
    assert.equal(retained.length, 1); assert.deepEqual(retained[0].drafts, original)
    assert.deepEqual(await storage.listArchives!('b'), [])
    retained[0].drafts[0].command.payload = null
    assert.deepEqual((await storage.listArchives!('a'))[0].drafts, original)
  } finally { storage.close() }
})
test('changed batch cannot be archived or partially removed', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  try {
    await storage.insert(draft()); const reviewed = await storage.list('a')
    await storage.setStatus('a', 'e', 'original', 'failed')
    await assert.rejects(storage.archiveBatch!('a', reviewed), /DRAFTS_CHANGED/)
    assert.equal((await storage.list('a'))[0].status, 'failed')
    assert.deepEqual(await storage.listArchives!('a'), [])
  } finally { storage.close() }
})
test('archive write failure aborts queue removal', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory()), add = IDBObjectStore.prototype.add
  try {
    await storage.insert(draft()); const reviewed = await storage.list('a')
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'archives') throw new DOMException('Injected quota failure', 'QuotaExceededError')
      return add.apply(this, args)
    }
    await assert.rejects(storage.archiveBatch!('a', reviewed), { name: 'QuotaExceededError' })
    assert.deepEqual(await storage.list('a'), reviewed)
    assert.deepEqual(await storage.listArchives!('a'), [])
  } finally { IDBObjectStore.prototype.add = add; storage.close() }
})
test('version 2 upgrade preserves the existing queue and confirmed cache', async () => {
  const factory = new IDBFactory(), original = draft()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('wedding-planner-fusion-drafts', 2)
    request.onupgradeneeded = () => { request.result.createObjectStore('outbox'); request.result.createObjectStore('confirmed') }
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['outbox', 'confirmed'], 'readwrite')
    tx.objectStore('outbox').put(original, ['a', 'e', 'original'])
    tx.objectStore('confirmed').put({ current: { projectId: 'a', capturedAt: 'retained' } }, 'a')
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
  })
  db.close(); const storage = await openIndexedDbOutbox(factory)
  try {
    assert.deepEqual(await storage.list('a'), [original])
    assert.equal((await storage.readConfirmed!('a'))?.capturedAt, 'retained')
    assert.deepEqual(await storage.listArchives!('a'), [])
  } finally { storage.close() }
})
