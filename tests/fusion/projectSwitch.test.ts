import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import type { Exclusive } from '../../src/fusion/repository.ts'
const exclusive: Exclusive = async (_key, body) => body()
function setup() {
  const store = new MemoryStore()
  for (const projectId of ['a', 'b']) {
    const data = emptyCore(); data.config.title = `项目${projectId}`
    store.seed(projectId, { managementHash: hashSecret(`manage-${projectId}`), collaborationHash: hashSecret(projectId.repeat(64)) }, { dataEpoch: 'same-epoch', snapshotRevision: 0, data })
  }
  const gateway = probeGateway(store, ['a', 'b'])
  return { store, a: gatewayTransport('a', 'a'.repeat(64), gateway), b: gatewayTransport('b', 'b'.repeat(64), gateway) }
}
function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
test('late old-project read cannot publish or cache after switch, even with identical epochs', async () => {
  const { a, b } = setup(), storage = await openIndexedDbOutbox(new IDBFactory()), entered = barrier(), finish = barrier()
  const old = projectRepository('a', storage, { ...a, read: async () => { const value = await a.read(); entered.release(); await finish.promise; return value } }, exclusive)
  const opening = old.open(); await entered.promise; old.stop()
  const next = projectRepository('b', storage, b, exclusive); await next.open()
  finish.release(); await opening
  assert.equal(old.getSnapshot().snapshot, null)
  assert.equal(next.getSnapshot().snapshot!.data.config.title, '项目b')
  assert.equal(await storage.readConfirmed!('a'), undefined)
  assert.equal((await storage.readConfirmed!('b'))!.snapshot.data.config.title, '项目b')
  assert.throws(() => old.captureExport(), /EXPORT_UNAVAILABLE/)
  next.stop(); storage.close()
})
test('same guest ID in a different project cannot consume, display or submit original drafts', async () => {
  const { a, b } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let offline = false
  const old = projectRepository('a', storage, { ...a, queryReceipt: async c => { if (offline) throw Error('OFFLINE'); return a.queryReceipt(c) } }, exclusive)
  await old.open(); offline = true
  await old.dispatch('guest.add', { id: 'same-id', name: 'A 的未提交宾客', group: '' }, {})
  const frozen = await old.readDrafts(); old.stop()
  const next = projectRepository('b', storage, b, exclusive); await next.open()
  assert.equal(next.getSnapshot().pending, 0); assert.deepEqual(await next.readDrafts(), [])
  await next.dispatch('guest.add', { id: 'same-id', name: 'B 的宾客', group: '' }, {})
  assert.equal(next.getSnapshot().snapshot!.data.guests['same-id'].name, 'B 的宾客')
  assert.deepEqual(await storage.list('a'), frozen)
  assert.equal((await a.read()).data.guests['same-id'], undefined)
  assert.equal((await b.read()).data.guests['same-id'].name, 'B 的宾客')
  next.stop(); storage.close()
})
test('switch during lost acknowledgement leaves original request recoverable and never targets the new project', async () => {
  const { a, b } = setup(), factory = new IDBFactory(), entered = barrier(), finish = barrier()
  const storageA = await openIndexedDbOutbox(factory); let executions = 0
  const delayed = { ...a, execute: async (command: Parameters<typeof a.execute>[0]) => {
    executions++; const receipt = await a.execute(command); entered.release(); await finish.promise; return receipt
  } }
  const old = projectRepository('a', storageA, delayed, exclusive); await old.open()
  const saving = old.dispatch('guest.add', { id: 'same-id', name: '只属于 A', group: '' }, {})
  await entered.promise
  const frozen = (await storageA.list('a'))[0].command
  old.stop(); storageA.close()
  const storageB = await openIndexedDbOutbox(factory), next = projectRepository('b', storageB, b, exclusive)
  await next.open(); finish.release(); await saving
  assert.deepEqual(next.getSnapshot().snapshot!.data.guestOrder, [])
  assert.deepEqual((await storageB.list('a'))[0].command, frozen)
  assert.deepEqual(await storageB.list('b'), [])
  const resumed = projectRepository('a', storageB, delayed, exclusive); await resumed.open()
  assert.equal(resumed.getSnapshot().status, 'resume_required'); await resumed.resume()
  assert.equal(executions, 1)
  assert.equal(resumed.getSnapshot().status, 'synced')
  assert.equal((await a.read()).data.guests['same-id'].name, '只属于 A')
  assert.deepEqual((await b.read()).data.guestOrder, [])
  resumed.stop(); next.stop(); storageB.close()
})
