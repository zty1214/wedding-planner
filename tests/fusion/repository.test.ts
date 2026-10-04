import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Core } from '../../src/fusion/core.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import type { Exclusive } from '../../src/fusion/repository.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { MemoryStore } from './memoryStore.ts'
import type { Command } from '../../src/fusion/protocol.ts'
const exclusive: Exclusive = async (_key, body) => body()
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const service = commandService(store, coreHandlers())
  let offline = false
  const online = () => { if (offline) throw Error('OFFLINE') }
  const transport = {
    read: async () => { online(); const s = (await service.read('a', 'secret'))!; return { ...s, data: s.data as Core } },
    execute: async (c: Command) => { online(); return service.execute(c, 'secret') },
    queryReceipt: async (c: Command) => { online(); return service.queryReceipt(c.projectId, c.dataEpoch, c.operationId, 'secret') },
  }
  return { store, transport, setOffline: (v: boolean) => { offline = v } }
}
test('project session preserves offline edits in insertion order and only resumes on confirmation', async () => {
  const { transport, setOffline } = setup(), factory = new IDBFactory()
  let storage = await openIndexedDbOutbox(factory)
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: '10', name: '第一位', group: '' }, {})
  await repo.dispatch('guest.add', { id: '2', name: '第二位', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'unknown')
  assert.equal(repo.getSnapshot().pending, 2)
  assert.deepEqual(repo.getSnapshot().snapshot!.data.guestOrder, ['10', '2'])
  repo.stop(); storage.close(); setOffline(false)
  storage = await openIndexedDbOutbox(factory); repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  assert.equal(repo.getSnapshot().status, 'resume_required')
  assert.equal(Object.keys((await transport.read()).data.guests).length, 0)
  await repo.resume()
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.deepEqual((await transport.read()).data.guestOrder, ['10', '2'])
  repo.stop(); storage.close()
})
test('local persistence failure does not change displayed state or submit the command', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', { ...storage, insert: async () => { throw Error('QUOTA') } }, transport, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '未保存', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'local_error')
  assert.equal(Object.keys(repo.getSnapshot().snapshot!.data.guests).length, 0)
  assert.equal(Object.keys((await transport.read()).data.guests).length, 0)
  storage.close()
})
test('old-epoch drafts remain visible and never replay into a restored project', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  await storage.insert({ command: { projectId: 'a', dataEpoch: 'old', operationId: 'op', commandVersion: 1, type: 'guest.add', payload: { id: 'g', name: '旧草稿', group: '' }, expectedRevisions: {} }, status: 'prepared' })
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); await repo.resume()
  assert.equal(repo.getSnapshot().status, 'conflict')
  assert.equal(repo.getSnapshot().pending, 1)
  assert.equal((await storage.list('a')).length, 1)
  assert.equal(Object.keys((await transport.read()).data.guests).length, 0)
  storage.close()
})


test('repository through authenticated gateway handles full response envelopes and refuses cross-project transport', async () => {
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a'])
  const transport = gatewayTransport('a', secret, gateway)
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '通过网关', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '通过网关')
  await assert.rejects(transport.execute({ projectId: 'b', dataEpoch: 'e', operationId: 'x', commandVersion: 1, type: 'guest.add', payload: {}, expectedRevisions: {} }), { code: 'FORBIDDEN' })
  const denied = gatewayTransport('a', 'b'.repeat(64), gateway)
  await assert.rejects(denied.read(), { code: 'FORBIDDEN' })
  storage.close()
})

test('existing page actions save through repository and preserve attendance independently of seating', async () => {
  const { createPageStore } = await import('../../src/fusion/pageStore.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  const notices: string[] = [], page = createPageStore('a', repo, text => notices.push(text))
  page.store.getState().addGuest('页面宾客', '朋友'); await repo.refresh()
  page.store.getState().addTable(10, 30, 50); await repo.refresh()
  let state = page.store.getState(), guestId = state.guests[0].id, tableId = state.tables[0].id
  state.updateGuest(guestId, { status: 'confirmed' }); await repo.refresh()
  page.store.getState().assignGuestToTable(guestId, tableId, 0); await repo.refresh()
  page.store.getState().assignGuestToTable(guestId, null, null); await repo.refresh()
  assert.equal(page.store.getState().guests[0].status, 'confirmed')
  page.store.getState().updateTable(tableId, { seats: 8, x: 60 }); await repo.refresh()
  assert.equal((await transport.read()).data.tables[tableId].x, 60)
  page.store.getState().setMainStagePos({ x: 10, y: 20 }); await repo.refresh()
  assert.deepEqual((await transport.read()).data.config.mainStagePos, { x: 10, y: 20 })
  page.store.getState().setStayDates([])
  assert.equal(notices.length, 1); assert.equal((await transport.read()).data.guestOrder.length, 1)
  page.unsubscribe(); repo.stop(); storage.close()
})

test('page forms receive durable-save result and can retry after local storage failure', async () => {
  const { createPageStore } = await import('../../src/fusion/pageStore.ts')
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const transport = gatewayTransport('a', secret, probeGateway(store, ['a']))
  const storage = await openIndexedDbOutbox(new IDBFactory())
  let fail = true, writes = 0
  const repo = projectRepository('a', { ...storage, insert: async value => {
    if (fail) throw Error('QUOTA')
    await storage.insert(value)
  } }, { ...transport, execute: async c => { writes++; return transport.execute(c) } }, exclusive)
  await repo.open()
  const page = createPageStore('a', repo, () => {})
  assert.equal(await page.store.getState().addNote('备忘', '保留标题', '不能丢的正文', []), false)
  assert.equal(repo.getSnapshot().status, 'local_error')
  assert.equal(writes, 0); assert.equal((await storage.list('a')).length, 0)
  fail = false
  assert.equal(await page.store.getState().addNote('备忘', '保留标题', '不能丢的正文', []), true)
  assert.equal(repo.getSnapshot().snapshot!.notes![0].content, '不能丢的正文')
  fail = true
  assert.equal(await page.store.getState().addGuest('保留姓名', '朋友'), false)
  fail = false
  assert.equal(await page.store.getState().addGuest('保留姓名', '朋友'), true)
  const guests = page.store.getState().guests
  assert.equal(guests.length, 1)
  page.unsubscribe(); repo.stop(); storage.close()
})

test('recycle list and restore traverse authenticated gateway and durable repository', async () => {
  const { previewRestore } = await import('../../src/fusion/recycle.ts')
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a']), transport = gatewayTransport('a', secret, gateway)
  const storage = await openIndexedDbOutbox(new IDBFactory()), repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  await repo.dispatch('guest.add', { id: 'g', name: '找回的宾客', group: '' }, {})
  await repo.dispatch('guest.delete', { id: 'g' }, { 'guest:g': 0 })
  const list = await repo.readRecycle()
  assert.equal(list.records.length, 1)
  assert.equal(repo.getSnapshot().snapshot!.data.guestOrder.length, 0)
  const revisions = previewRestore(repo.getSnapshot().snapshot!.data, list.records[0])
  await repo.dispatch('recycle.restore', { id: list.records[0].id }, revisions)
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '找回的宾客')
  assert.equal((await repo.readRecycle()).records.length, 0)
  await assert.rejects(gatewayTransport('a', 'b'.repeat(64), gateway).readRecycle!(), { code: 'FORBIDDEN' })
  const malformed = gatewayTransport('a', secret, async () => ({ ok: true, value: { dataEpoch: 'e', records: [list.records[0], list.records[0]] } }))
  await assert.rejects(malformed.readRecycle!(), /INVALID_RECYCLE_RESPONSE/)
  repo.stop(); storage.close()
})

test('successful refresh after initial network failure initializes the editable session', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  setOffline(true); await repo.open(); setOffline(false); await repo.refresh()
  assert.equal(await repo.dispatch('guest.add', { id: 'g', name: '恢复连接', group: '' }, {}), true)
  assert.equal(repo.getSnapshot().status, 'synced')
  repo.stop(); storage.close()
})

test('another tab cannot silently submit a reopened draft and refresh discovers shared pending work', async () => {
  const { transport, setOffline } = setup(), factory = new IDBFactory()
  const aStorage = await openIndexedDbOutbox(factory), bStorage = await openIndexedDbOutbox(factory)
  const a = projectRepository('a', aStorage, transport, exclusive)
  const b = projectRepository('a', bStorage, transport, exclusive)
  await a.open(); await b.open(); setOffline(true)
  await a.dispatch('guest.add', { id: 'a', name: '未确认草稿', group: '' }, {})
  a.stop(); setOffline(false)
  const reopened = projectRepository('a', aStorage, transport, exclusive)
  await reopened.open()
  assert.equal(reopened.getSnapshot().status, 'resume_required')
  await b.dispatch('guest.add', { id: 'b', name: '另一个标签页', group: '' }, {})
  assert.equal(b.getSnapshot().status, 'resume_required')
  assert.deepEqual((await transport.read()).data.guestOrder, [])
  await b.resume()
  assert.deepEqual((await transport.read()).data.guestOrder, ['a', 'b'])
  const c = projectRepository('a', bStorage, transport, exclusive)
  await c.open(); setOffline(true)
  await b.dispatch('guest.add', { id: 'later', name: '新草稿', group: '' }, {})
  setOffline(false); await c.refresh()
  assert.equal(c.getSnapshot().status, 'resume_required')
  assert.equal(c.getSnapshot().pending, 1)
  b.stop(); c.stop(); reopened.stop(); aStorage.close(); bStorage.close()
})

test('permission loss clears visible state, stops polling requests, and explicit reauthorization preserves operation ID', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let denied = false, reads = 0
  const check = () => { if (denied) throw new CommandError('FORBIDDEN') }
  const guarded = { ...transport,
    read: async () => { reads++; check(); return transport.read() },
    queryReceipt: async (c: Command) => { check(); return transport.queryReceipt(c) },
    execute: async (c: Command) => { check(); return transport.execute(c) },
  }
  const repo = projectRepository('a', storage, guarded, exclusive)
  await repo.open(); denied = true
  await repo.dispatch('guest.add', { id: 'g', name: '保留草稿', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'forbidden'); assert.equal(repo.getSnapshot().snapshot, null)
  const draft = (await storage.list('a'))[0]
  assert.equal(draft.status, 'forbidden')
  const beforeReads = reads
  await repo.refresh(); await repo.refresh()
  assert.equal(reads, beforeReads)
  denied = false; await repo.resume()
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.ok(await transport.queryReceipt(draft.command))
  assert.deepEqual((await storage.list('a')), [])
  denied = true; await repo.refresh()
  assert.equal(repo.getSnapshot().snapshot, null)
  repo.stop(); storage.close()
})

test('offline consecutive note edits project revisions locally and synchronize without self-conflict', async () => {
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  let offline = false
  const gateway = probeGateway(store, ['a']), transport = gatewayTransport('a', secret, event => {
    if (offline) throw Error('OFFLINE')
    return gateway(event)
  })
  const storage = await openIndexedDbOutbox(new IDBFactory()), repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  const note = { id: 'n', category: '酒店', title: '笔记', content: '初稿' }
  await repo.dispatch('note.add', note, {})
  offline = true
  await repo.dispatch('note.update', { ...note, content: '第二稿' }, { 'note:n': 0 })
  assert.equal(repo.getSnapshot().snapshot!.notes![0].content, '第二稿')
  assert.equal(repo.getSnapshot().snapshot!.notes![0].revision, 1)
  await repo.dispatch('note.update', { ...note, content: '第三稿' }, { 'note:n': 1 })
  assert.equal(repo.getSnapshot().snapshot!.notes![0].content, '第三稿')
  offline = false; await repo.resume()
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal((await transport.read()).notes![0].content, '第三稿')
  assert.equal((await transport.read()).notes![0].revision, 2)
  repo.stop(); storage.close()
})

test('oversized UTF-8 input is rejected before persistence and does not poison the project queue', async () => {
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  let requests = 0
  const gateway = probeGateway(store, ['a']), transport = gatewayTransport('a', secret, event => { requests++; return gateway(event) })
  const storage = await openIndexedDbOutbox(new IDBFactory()), repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); const before = requests
  const note = { id: 'n', category: '酒店', title: '笔记', content: '中'.repeat(6000) }
  assert.equal(await repo.dispatch('note.add', note, {}), false)
  assert.equal(repo.getSnapshot().error, 'REQUEST_TOO_LARGE')
  assert.equal(requests, before); assert.equal((await storage.list('a')).length, 0)
  assert.equal(await repo.dispatch('note.add', { ...note, content: '中'.repeat(1000) }, {}), true)
  assert.equal(repo.getSnapshot().status, 'synced')
  const tooLarge = await gateway({ action: 'execute', projectId: 'a', secret, command: {
    projectId: 'a', dataEpoch: 'e', operationId: 'oversized', commandVersion: 1, type: 'note.add', payload: note, expectedRevisions: {},
  } })
  assert.deepEqual(tooLarge, { ok: false, error: { code: 'REQUEST_TOO_LARGE' } })
  repo.stop(); storage.close()
})

test('a foreign draft inserted between flush reads still requires explicit approval', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let insertOnNextPendingRead = false, flushReads = 0
  const wrapped = { ...storage, list: async (id: string, epoch?: string) => {
    if (insertOnNextPendingRead && ++flushReads === 2) {
      await storage.insert({ status: 'prepared', command: { projectId: 'a', dataEpoch: 'e', operationId: 'foreign', commandVersion: 1,
        type: 'guest.add', payload: { id: 'foreign', name: '其它标签草稿', group: '' }, expectedRevisions: {} } })
    }
    return storage.list(id, epoch)
  } }
  const repo = projectRepository('a', wrapped, transport, exclusive)
  await repo.open(); insertOnNextPendingRead = true
  await repo.dispatch('guest.add', { id: 'own', name: '当前修改', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'resume_required')
  assert.deepEqual((await transport.read()).data.guestOrder, [])
  assert.equal((await storage.list('a')).length, 2)
  await repo.resume()
  assert.deepEqual((await transport.read()).data.guestOrder, ['own', 'foreign'])
  repo.stop(); storage.close()
})

test('denial from history reads also clears all visible remote state immediately', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, { ...transport, readHistory: async () => { throw new CommandError('FORBIDDEN') } }, exclusive)
  await repo.open()
  await assert.rejects(repo.readHistory(), { code: 'FORBIDDEN' })
  assert.equal(repo.getSnapshot().snapshot, null); assert.equal(repo.getSnapshot().status, 'forbidden')
  repo.stop(); storage.close()
})
