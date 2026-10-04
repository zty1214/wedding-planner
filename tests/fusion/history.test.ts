import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('private-manager') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const core = commandService(store, coreHandlers()), notes = noteService(store), history = historyService(store)
  const command = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  return { store, core, notes, history, command }
}
test('manual version freezes core and all notes with no credentials or per-edit versions', async () => {
  const { store, core, notes, history, command } = setup()
  await core.execute(command('guest.add', { id: 'g', name: '宾客甲', group: '' }), 'secret')
  for (const id of ['a', 'b']) await notes.execute(command('note.add', { id, category: '酒店', title: id, content: '原正文' }), 'secret')
  assert.deepEqual((await history.list('a', 'secret')).versions, [])
  const save = command('version.save', { name: '确认版' }, { snapshot: 1, notes: 2 })
  const receipt = await history.execute(save, 'secret')
  assert.deepEqual(await history.execute(save, 'secret'), receipt)
  const list = await history.list('a', 'secret'); assert.equal(list.versions.length, 1)
  const frozen = await history.read('a', 'secret', list.versions[0].id)
  assert.equal(frozen.expiresAt, null); assert.equal(frozen.notes.length, 2)
  assert.deepEqual(frozen.notes.map(n => n.id), ['b', 'a'])
  assert.equal(Object.hasOwn(frozen, 'access'), false)
  assert.equal(JSON.stringify(frozen).includes(hashSecret('private-manager')), false)
  const activity = structuredClone(store.projects.get('a')!.activity)
  await core.execute(command('guest.update', { id: 'g', patch: { name: '后来修改' } }, { 'guest:g': 0 }), 'secret')
  await notes.execute(command('note.update', { id: 'a', category: '酒店', title: 'a', content: '后来正文' }, { 'note:a': 0 }), 'secret')
  assert.deepEqual(await history.read('a', 'secret', frozen.id), frozen)
  assert.equal(frozen.core.guests.g.name, '宾客甲'); assert.equal(frozen.notes[1].content, '原正文')
  assert.equal([...activity.values()][0], 3)
  await assert.rejects(history.execute({ ...save, payload: { name: '换名' } }, 'secret'), { code: 'OPERATION_ID_REUSED' })
  await assert.rejects(history.list('a', 'wrong'), { code: 'FORBIDDEN' })
  await assert.rejects(history.read('a', 'wrong', frozen.id), { code: 'FORBIDDEN' })
})
test('stale version group and receipt failure never publish partial snapshots', async () => {
  const { store, notes, history, command } = setup()
  await notes.execute(command('note.add', { id: 'n', category: '酒店', title: '', content: '正文' }), 'secret')
  const before = structuredClone(store.projects.get('a'))
  await assert.rejects(history.execute(command('version.save', { name: '旧笔记' }, { snapshot: 0, notes: 0 }), 'secret'), { code: 'CONFLICT' })
  assert.deepEqual(store.projects.get('a'), before)
  store.failReceipt = true
  await assert.rejects(history.execute(command('version.save', { name: '失败版本' }, { snapshot: 0, notes: 1 }), 'secret'))
  assert.deepEqual(store.projects.get('a'), before)
})
test('version list pages metadata with stable cursor when new versions are added', async () => {
  const { history, command } = setup()
  for (let i = 0; i < 21; i++) await history.execute(command('version.save', { name: `版本${i}` }, { snapshot: 0, notes: 0 }), 'secret')
  const first = await history.list('a', 'secret')
  assert.equal(first.versions.length, 20); assert.ok(first.nextCursor)
  assert.equal(Object.hasOwn(first.versions[0], 'core'), false)
  await history.execute(command('version.save', { name: '新版本' }, { snapshot: 0, notes: 0 }), 'secret')
  const second = await history.list('a', 'secret', first.nextCursor)
  assert.equal(second.versions.length, 1); assert.equal(second.versions[0].name, '版本0'); assert.equal(second.nextCursor, null)
})

test('repository saves versions through durable gateway and refuses mixing unsynced drafts', async () => {
  const { IDBFactory } = await import('fake-indexeddb')
  const { openIndexedDbOutbox } = await import('../../src/fusion/indexedDbOutbox.ts')
  const { gatewayTransport } = await import('../../src/fusion/gatewayTransport.ts')
  const { projectRepository } = await import('../../src/fusion/repository.ts')
  const { probeGateway } = await import('../../server/fusion/probeGateway.ts')
  const { store } = setup(), secret = 'a'.repeat(64)
  store.projects.get('a')!.access.collaborationHash = hashSecret(secret)
  let offline = false
  const gateway = probeGateway(store, ['a'])
  const transport = gatewayTransport('a', secret, event => { if (offline) throw Error('OFFLINE'); return gateway(event) })
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, async (_key, body) => body())
  await repo.open()
  assert.equal(await repo.dispatch('version.save', { name: '页面版本' }, { snapshot: 0, notes: 0 }), true)
  const list = await repo.readHistory()
  assert.equal(list.versions.length, 1)
  assert.equal((await repo.readVersion(list.versions[0].id)).name, '页面版本')
  offline = true
  await repo.dispatch('guest.add', { id: 'g', name: '本机草稿', group: '' }, {})
  assert.equal(await repo.dispatch('version.save', { name: '不能保存' }, { snapshot: 0, notes: 0 }), false)
  assert.equal((await storage.list('a')).length, 1)
  offline = false
  await repo.resume()
  assert.equal((await repo.readHistory()).versions.length, 1)
  repo.stop(); storage.close()
})

test('manager restoration atomically switches core and notes, retaining safety version and current credentials', async () => {
  const { store, core, notes, history, command } = setup()
  const note = { id: 'n', category: '酒店', title: '目标', content: '旧正文' }
  await core.execute(command('guest.add', { id: 'g', name: '旧宾客', group: '' }), 'secret')
  await notes.execute(command('note.add', note), 'secret')
  await history.execute(command('version.save', { name: '目标版本' }, { snapshot: 1, notes: 1 }), 'secret')
  const target = (await history.list('a', 'secret')).versions[0]
  await core.execute(command('guest.update', { id: 'g', patch: { name: '恢复前的新宾客' } }, { 'guest:g': 0 }), 'secret')
  await notes.execute(command('note.update', { ...note, content: '恢复前的新正文' }, { 'note:n': 0 }), 'secret')
  const restore = command('version.restore', { id: target.id }, { snapshot: 2, notes: 2 })
  const before = structuredClone(store.projects.get('a')!)
  await assert.rejects(history.execute(restore, 'secret'), { code: 'FORBIDDEN' })
  await assert.rejects(history.execute({ ...restore, expectedRevisions: { snapshot: 2, notes: 1 } }, 'private-manager'), { code: 'CONFLICT' })
  store.failReceipt = true
  await assert.rejects(history.execute(restore, 'private-manager'))
  assert.deepEqual(store.projects.get('a'), before)
  store.failReceipt = false
  const receipt = await history.execute(restore, 'private-manager')
  assert.ok(receipt.resultDataEpoch); assert.notEqual(receipt.resultDataEpoch, 'e')
  assert.deepEqual(await history.execute(restore, 'private-manager'), receipt)
  const result = await notes.read('a', 'secret')
  assert.equal((result.current.data as import('../../src/fusion/core.ts').Core).guests.g.name, '旧宾客')
  assert.equal(result.notes[0].content, '旧正文'); assert.equal(result.dataEpoch, receipt.resultDataEpoch)
  const versions = (await history.list('a', 'secret')).versions
  assert.equal(versions.length, 2); assert.equal(versions[0].kind, 'safety')
  const safety = await history.read('a', 'secret', versions[0].id)
  assert.equal(safety.core.guests.g.name, '恢复前的新宾客'); assert.equal(safety.notes[0].content, '恢复前的新正文')
  assert.equal(Date.parse(safety.expiresAt!) - Date.parse(safety.capturedAt), 90 * 86400000)
  assert.deepEqual(store.projects.get('a')!.access, before.access)
  await assert.rejects(core.execute(command('guest.add', { id: 'old', name: '旧草稿', group: '' }), 'secret'), { code: 'PROJECT_REPLACED' })
  assert.deepEqual(await core.queryReceipt('a', 'e', restore.operationId, 'private-manager'), receipt)
})

test('lost restore response reconciles old receipt after reopen without replaying old drafts', async () => {
  const { IDBFactory } = await import('fake-indexeddb')
  const { openIndexedDbOutbox } = await import('../../src/fusion/indexedDbOutbox.ts')
  const { gatewayTransport } = await import('../../src/fusion/gatewayTransport.ts')
  const { projectRepository } = await import('../../src/fusion/repository.ts')
  const { probeGateway } = await import('../../server/fusion/probeGateway.ts')
  const { store, history, command } = setup(), secret = 'a'.repeat(64)
  store.projects.get('a')!.access.managementHash = hashSecret(secret)
  await history.execute(command('version.save', { name: '恢复点' }, { snapshot: 0, notes: 0 }), secret)
  const id = (await history.list('a', secret)).versions[0].id
  const gateway = probeGateway(store, ['a'])
  let restoreExecutions = 0
  const transport = gatewayTransport('a', secret, async event => {
    const result = await gateway(event)
    if (event.action === 'execute' && (event.command as Command).type === 'version.restore') { restoreExecutions++; throw Error('RESPONSE_LOST') }
    return result
  })
  const factory = new IDBFactory()
  let storage = await openIndexedDbOutbox(factory)
  let repo = projectRepository('a', storage, transport, async (_key, body) => body())
  await repo.open()
  await repo.dispatch('version.restore', { id }, { snapshot: 0, notes: 0 })
  assert.equal(repo.getSnapshot().status, 'unknown')
  repo.stop(); storage.close()
  storage = await openIndexedDbOutbox(factory)
  repo = projectRepository('a', storage, transport, async (_key, body) => body())
  await repo.open(); assert.equal(repo.getSnapshot().status, 'conflict')
  await repo.resume()
  assert.equal(repo.getSnapshot().status, 'synced'); assert.equal(restoreExecutions, 1)
  assert.equal((await storage.list('a')).length, 0)
  await storage.insert({ command: command('guest.add', { id: 'stale', name: '仍需核对', group: '' }), status: 'prepared' })
  await repo.resume()
  assert.equal(repo.getSnapshot().status, 'conflict'); assert.equal((await storage.list('a')).length, 1)
  assert.equal((await transport.read()).data.guests.stale, undefined)
  repo.stop(); storage.close()
})

test('pre-restore recycle entries remain readable but cannot restore into new epoch', async () => {
  const { recycleService } = await import('../../server/fusion/recycleService.ts')
  const { store, core, history, command } = setup(), recycle = recycleService(store)
  await core.execute(command('guest.add', { id: 'g', name: '旧代次宾客', group: '' }), 'secret')
  await history.execute(command('version.save', { name: '恢复点' }, { snapshot: 1, notes: 0 }), 'secret')
  const id = (await history.list('a', 'secret')).versions[0].id
  const deleted = command('guest.delete', { id: 'g' }, { 'guest:g': 0 })
  await recycle.execute(deleted, 'secret')
  const restored = await history.execute(command('version.restore', { id }, { snapshot: 2, notes: 0 }), 'private-manager')
  const list = await recycle.list('a', 'secret')
  assert.equal(list.dataEpoch, restored.resultDataEpoch)
  assert.equal(list.records.length, 1); assert.equal(list.records[0].dataEpoch, 'e')
  await assert.rejects(recycle.execute({ ...command('recycle.restore', { id: deleted.operationId }), dataEpoch: restored.resultDataEpoch! }, 'secret'), { code: 'CONFLICT' })
})
