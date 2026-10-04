import { previewRestore, assertRecycleRecord } from '../../src/fusion/recycle.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 7, data: emptyCore() })
  const service = noteService(store, () => new Date('2026-10-04T12:00:00Z'))
  const command = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  return { store, service, command }
}
test('text notes have server timestamps and independent revisions; retry is idempotent', async () => {
  const { service, command, store } = setup()
  const add = command('note.add', { id: 'n', title: '', content: '酒店报价', category: '酒店' })
  const r = await service.execute(add, 'secret')
  assert.deepEqual(await service.execute(add, 'secret'), r)
  assert.equal(r.snapshotRevision, 7); assert.equal(r.notesRevision, 1)
  await service.execute(command('note.update', { id: 'n', title: '酒店', content: '更新报价', category: '酒店' }, { 'note:n': 0 }), 'secret')
  const result = await service.read('a', 'secret')
  assert.equal(result.notesRevision, 2); assert.equal(result.notes[0].revision, 1)
  assert.equal(result.notes[0].createdAt, '2026-10-04T12:00:00.000Z')
  assert.equal(store.projects.get('a')!.current.snapshotRevision, 7)
  assert.equal([...store.projects.get('a')!.activity.values()][0], 2)
})
test('stale edits and extra attachment fields rejected; note and receipt failure roll back together', async () => {
  const { service, command, store } = setup()
  const payload = { id: 'n', title: '', content: '笔记', category: '酒店' }
  await service.execute(command('note.add', payload), 'secret')
  await assert.rejects(service.execute(command('note.update', payload, { 'note:n': 1 }), 'secret'), { code: 'CONFLICT' })
  await assert.rejects(service.execute(command('note.add', { ...payload, id: 'x', images: ['image'] }), 'secret'), { code: 'INVALID_INPUT' })
  const before = structuredClone(store.projects.get('a'))
  store.failReceipt = true
  await assert.rejects(service.execute(command('note.update', { ...payload, content: '不能部分写入' }, { 'note:n': 0 }), 'secret'))
  assert.deepEqual(store.projects.get('a'), before)
  await assert.rejects(service.read('a', 'wrong'), { code: 'FORBIDDEN' })
  await assert.rejects(service.execute({ ...command('note.update', payload), dataEpoch: 'old' }, 'secret'), { code: 'PROJECT_REPLACED' })
})

test('notes traverse page adapter, durable queue and gateway, then reread without touching core revision', async () => {
  const { IDBFactory } = await import('fake-indexeddb')
  const { openIndexedDbOutbox } = await import('../../src/fusion/indexedDbOutbox.ts')
  const { projectRepository } = await import('../../src/fusion/repository.ts')
  const { gatewayTransport } = await import('../../src/fusion/gatewayTransport.ts')
  const { probeGateway } = await import('../../server/fusion/probeGateway.ts')
  const { createPageStore } = await import('../../src/fusion/pageStore.ts')
  const { store } = setup(), secret = 'a'.repeat(64)
  store.projects.get('a')!.access.collaborationHash = hashSecret(secret)
  const transport = gatewayTransport('a', secret, probeGateway(store, ['a']))
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, async (_key, body) => body())
  await repo.open()
  const page = createPageStore('a', repo, () => {})
  page.store.getState().addNote('酒店', '', '第一份文本', [])
  await repo.refresh()
  const id = page.store.getState().notes[0].id
  page.store.getState().updateNote(id, { content: '修订后的文本' })
  await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal(page.store.getState().notes[0].content, '修订后的文本')
  assert.equal((await transport.read()).snapshotRevision, 7)
  assert.equal((await transport.read()).notesRevision, 2)
  assert.equal((await storage.list('a')).length, 0)
  page.store.getState().removeNote(id); await repo.refresh()
  assert.equal(page.store.getState().notes.length, 0)
  const deleted = (await repo.readRecycle()).records[0]
  await repo.dispatch('recycle.restore', { id: deleted.id }, {})
  assert.equal(page.store.getState().notes[0].content, '修订后的文本')
  assert.equal((await transport.read()).snapshotRevision, 7)
  assert.equal((await transport.read()).notesRevision, 4)
  page.unsubscribe(); repo.stop(); storage.close()
})

test('note deletion and restoration preserve content/order and advance only notes revision', async () => {
  const { recycleService } = await import('../../server/fusion/recycleService.ts')
  const { store, service, command } = setup(), recycle = recycleService(store, () => new Date('2026-10-04T12:00:00Z'))
  const payload = { id: 'n', category: '酒店', title: '不能丢的笔记', content: '完整正文' }
  await service.execute(command('note.add', payload), 'secret')
  await service.execute(command('note.add', { ...payload, id: 'other' }), 'secret')
  const deletion = command('note.delete', { id: 'n' }, { 'note:n': 0 })
  const original = structuredClone(store.projects.get('a'))
  store.failReceipt = true
  await assert.rejects(recycle.execute(deletion, 'secret'))
  assert.deepEqual(store.projects.get('a'), original)
  store.failReceipt = false
  const receipt = await recycle.execute(deletion, 'secret')
  assert.deepEqual(await recycle.execute(deletion, 'secret'), receipt)
  assert.equal(receipt.snapshotRevision, 7); assert.equal(receipt.notesRevision, 3)
  assert.deepEqual((await service.read('a', 'secret')).notes.map(n => n.id), ['other'])
  const record = (await recycle.list('a', 'secret')).records[0]
  assertRecycleRecord(record)
  assert.deepEqual(previewRestore(emptyCore(), record, []), {})
  await service.execute(command('note.update', { ...payload, id: 'other', content: '其他笔记后来修改' }, { 'note:other': 0 }), 'secret')
  await assert.rejects(service.execute(command('note.add', payload), 'secret'), { code: 'CONFLICT' })
  const restore = command('recycle.restore', { id: record.id })
  const beforeRestore = structuredClone(store.projects.get('a'))
  store.failReceipt = true
  await assert.rejects(recycle.execute(restore, 'secret'))
  assert.deepEqual(store.projects.get('a'), beforeRestore)
  store.failReceipt = false
  const restored = await recycle.execute(restore, 'secret')
  assert.deepEqual(await recycle.execute(restore, 'secret'), restored)
  const notes = (await service.read('a', 'secret')).notes
  assert.deepEqual(notes.map(n => n.id), ['other', 'n'])
  assert.equal(notes[1].content, payload.content); assert.equal(notes[1].revision, 1)
  assert.equal(notes[0].content, '其他笔记后来修改')
  assert.throws(() => previewRestore(emptyCore(), record, notes), { code: 'CONFLICT' })
  await assert.rejects(service.execute(command('note.update', payload, { 'note:n': 0 }), 'secret'), { code: 'CONFLICT' })
  await assert.rejects(recycle.execute(command('recycle.restore', { id: record.id }), 'secret'), { code: 'CONFLICT' })
  assert.equal((await service.read('a', 'secret')).current.snapshotRevision, 7)
})
