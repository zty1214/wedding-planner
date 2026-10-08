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

test('discarding a conflict reloads cloud state and unblocks new edits without undoing another client', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '初始', group: '' }, {})
  await transport.execute({ projectId: 'a', dataEpoch: 'e', operationId: 'other', commandVersion: 1, type: 'guest.update', payload: { id: 'g', patch: { name: '另一设备修改' } }, expectedRevisions: { 'guest:g': 0 } })
  await repo.dispatch('guest.update', { id: 'g', patch: { name: '冲突草稿' } }, { 'guest:g': 0 })
  assert.equal(repo.getSnapshot().status, 'conflict')
  const drafts = await repo.readDrafts()
  assert.equal(drafts.length, 1); assert.equal(drafts[0].status, 'conflict')
  assert.deepEqual(await repo.discardDrafts(drafts), { discarded: 1, alreadyCommitted: 0 })
  assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '另一设备修改')
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal(await repo.dispatch('guest.update', { id: 'g', patch: { name: '人工核对后的新意图' } }, { 'guest:g': 1 }), true)
  assert.equal((await transport.read()).data.guests.g.name, '人工核对后的新意图')
  repo.stop(); storage.close()
})

test('discard refuses an unresolved result but clears a confirmed lost response without undoing the write', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let commit = false
  const wrapped = { ...transport, execute: async (c: Command) => { if (commit) await transport.execute(c); throw Error('RESPONSE_LOST') } }
  const repo = projectRepository('a', storage, wrapped, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '结果未定', group: '' }, {})
  const drafts = await repo.readDrafts()
  await assert.rejects(repo.discardDrafts(drafts), /RESULT_STILL_UNKNOWN/)
  assert.equal((await storage.list('a')).length, 1)
  // The original request is later confirmed committed; no replacement ID or repeat business write.
  commit = true
  await assert.rejects(wrapped.execute(drafts[0].command), /RESPONSE_LOST/)
  assert.deepEqual(await repo.discardDrafts(drafts), { discarded: 0, alreadyCommitted: 1 })
  assert.equal((await transport.read()).data.guests.g.name, '结果未定')
  assert.equal((await storage.list('a')).length, 0)
  repo.stop(); storage.close()
})

test('discard is atomic and refuses drafts added during remote verification', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const first: Command = { projectId: 'a', dataEpoch: 'e', operationId: 'one', commandVersion: 1, type: 'guest.add', payload: { id: 'g', name: '未发出', group: '' }, expectedRevisions: {} }
  await storage.insert({ command: first, status: 'prepared' })
  let insert = false
  const repo = projectRepository('a', storage, { ...transport, read: async () => {
    if (insert) { await storage.insert({ command: { ...first, operationId: 'two', payload: { id: 'h', name: '后来的草稿', group: '' } }, status: 'prepared' }); insert = false }
    return transport.read()
  } }, exclusive)
  await repo.open(); const drafts = await repo.readDrafts(); insert = true
  await assert.rejects(repo.discardDrafts(drafts), /DRAFTS_CHANGED/)
  assert.equal((await storage.list('a')).length, 2)
  assert.deepEqual((await transport.read()).data.guestOrder, [])
  assert.deepEqual(await repo.discardDrafts(await repo.readDrafts()), { discarded: 2, alreadyCommitted: 0 })
  repo.stop(); storage.close()
})

test('discard only touches the reviewed project, keeps stale-epoch drafts until explicit discard, and propagates persistence failure', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const command: Command = { projectId: 'a', dataEpoch: 'old', operationId: 'one', commandVersion: 1, type: 'guest.add', payload: { id: 'g', name: '恢复前草稿', group: '' }, expectedRevisions: {} }
  await storage.insert({ command, status: 'result_unknown' })
  await storage.insert({ command: { ...command, projectId: 'b' }, status: 'prepared' })
  let fail = true
  const repo = projectRepository('a', { ...storage, removeBatch: async (id, entries) => { if (fail) throw Error('QUOTA'); return storage.removeBatch(id, entries) } }, transport, exclusive)
  await repo.open(); assert.equal(repo.getSnapshot().status, 'conflict')
  const drafts = await repo.readDrafts()
  await assert.rejects(repo.discardDrafts(drafts), /QUOTA/)
  assert.equal((await repo.readDrafts()).length, 1)
  fail = false; await repo.discardDrafts(drafts)
  assert.equal((await storage.list('b')).length, 1)
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.deepEqual((await transport.read()).data.guestOrder, [])
  repo.stop(); storage.close()
})

test('queued form commands keep their original epoch when refresh observes a restored project', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let release!: () => void, entered!: () => void, waitForRead = false, sends = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const reading = new Promise<void>(resolve => { entered = resolve })
  const repo = projectRepository('a', storage, { ...transport,
    read: async () => {
      const snapshot = await transport.read()
      if (!waitForRead) return snapshot
      entered(); await gate
      return { ...snapshot, dataEpoch: 'restored' }
    },
    execute: async c => { sends++; return transport.execute(c) },
  }, exclusive)
  await repo.open(); waitForRead = true
  const refresh = repo.refresh(); await reading
  const save = repo.dispatch('note.add', { id: 'old-form', category: '备忘', title: '', content: '旧代次正文' }, {})
  release(); await refresh
  assert.equal(await save, false)
  assert.equal(repo.getSnapshot().error, 'PROJECT_REPLACED')
  assert.equal(sends, 0); assert.deepEqual(await storage.list('a'), [])
  // A recovered form supplies its own epoch even if the repository has already refreshed.
  assert.equal(await repo.dispatch('note.add', { id: 'recovered', category: '备忘', title: '', content: '旧草稿' }, {}, 'e'), false)
  assert.equal(sends, 0); assert.deepEqual(await storage.list('a'), [])
  repo.stop(); storage.close()
})

test('page attendance and side are independent: declining releases seating but keeps lodging', async () => {
  const { createPageStore } = await import('../../src/fusion/pageStore.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  const page = createPageStore('a', repo, () => {})
  await page.store.getState().addGuest('小明 2', '新郎亲属', '00123')
  await page.store.getState().addTable(8, 0, 0)
  await page.store.getState().addRoom('标间')
  const g = page.store.getState().guests[0].id, t = page.store.getState().tables[0].id, r = page.store.getState().rooms[0].id
  await page.store.getState().setGuestStayNeed!(g, 'needed')
  await page.store.getState().assignGuestToRoom(g, r)
  await page.store.getState().addStayDate('2026-10-06')
  await page.store.getState().setGuestStayDates(g, ['2026-10-06'])
  await page.store.getState().assignGuestToTable(g, t, 0)
  await page.store.getState().updateGuest(g, { attendance: 'declined', side: 'shared', status: 'confirmed' })
  let value = page.store.getState().guests[0]
  assert.equal(value.attendance, 'declined'); assert.equal(value.side, 'shared')
  assert.equal(value.tableId, null); assert.equal(value.seatIndex, null)
  assert.equal(value.roomId, r); assert.deepEqual(value.stayDates, ['2026-10-06'])
  assert.equal(await page.store.getState().assignGuestToTable(g, t, 0), false)
  await page.store.getState().updateGuest(g, { attendance: 'confirmed' })
  value = page.store.getState().guests[0]
  assert.equal(value.attendance, 'confirmed'); assert.equal(value.tableId, null)
  assert.equal(value.group, '新郎亲属'); assert.equal(value.phone, '00123')
  await page.store.getState().assignGuestToTable(g, t, 0)
  await page.store.getState().assignGuestToTable(g, null, null)
  assert.equal(page.store.getState().guests[0].attendance, 'confirmed')
  page.unsubscribe(); repo.stop(); storage.close()
})

test('exports freeze confirmed data separately from local optimistic edits and retain provenance', async () => {
  const { buildExportWorkbook } = await import('../../src/fusion/exportWorkbook.ts')
  const XLSX = await import('xlsx')
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '已确认版本姓名', group: '' }, {})
  setOffline(true)
  await repo.dispatch('guest.update', { id: 'g', patch: { name: '尚未同步的姓名' } }, { 'guest:g': 0 })
  const confirmed = repo.captureExport(), draft = repo.captureExport('draft')
  assert.equal(confirmed.snapshot.data.guests.g.name, '已确认版本姓名')
  assert.equal(draft.snapshot.data.guests.g.name, '尚未同步的姓名')
  const artifact = buildExportWorkbook(draft, 'guests')
  assert.match(artifact.filename, /本机未同步草稿/)
  const workbook = XLSX.read(XLSX.write(artifact.workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  assert.match(workbook.Props!.Subject!, /项目 a；代次 e/)
  assert.equal(workbook.Sheets['宾客名单'].A2.v, '尚未同步的姓名')
  setOffline(false); await repo.resume()
  assert.equal(repo.captureExport().snapshot.data.guests.g.name, '尚未同步的姓名')
  assert.equal(confirmed.snapshot.data.guests.g.name, '已确认版本姓名')
  draft.snapshot.data.guests.g.name = '篡改导出副本'
  assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '尚未同步的姓名')
  repo.stop(); assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/); storage.close()
})

test('same-session deletion is projected but reopened queues still require review', async () => {
  const { transport, setOffline } = setup(), factory = new IDBFactory(), storage = await openIndexedDbOutbox(factory)
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '待删', group: '' }, {})
  setOffline(true); await repo.dispatch('guest.delete', { id: 'g' }, { 'guest:g': 0 })
  assert.equal(repo.captureExport('draft').snapshot.data.guestOrder.length, 0)
  assert.equal(repo.captureExport().snapshot.data.guestOrder.length, 1)
  repo.stop(); setOffline(false)
  repo = projectRepository('a', storage, transport, exclusive); await repo.open()
  assert.equal(repo.getSnapshot().status, 'resume_required')
  assert.throws(() => repo.captureExport('draft'), /DRAFT_EXPORT_UNAVAILABLE/)
  assert.equal(repo.captureExport().snapshot.data.guestOrder.length, 1)
  repo.stop(); storage.close()
})

test('authorization denial clears access to both confirmed and draft exports', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let denied = false
  const repo = projectRepository('a', storage, { ...transport, read: async () => {
    if (denied) throw new CommandError('FORBIDDEN')
    return transport.read()
  } }, exclusive)
  await repo.open(); assert.equal(repo.captureExport().projectId, 'a')
  denied = true; await repo.refresh()
  assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/)
  assert.throws(() => repo.captureExport('draft'), /EXPORT_UNAVAILABLE/)
  repo.stop(); storage.close()
})

test('same-page reconnect auto-flushes approved drafts in order using original operation IDs', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const executed: string[] = []
  const repo = projectRepository('a', storage, { ...transport, execute: async c => {
    executed.push(c.operationId); return transport.execute(c)
  } }, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: 'g', name: '断网新增', group: '' }, {})
  await repo.dispatch('guest.update', { id: 'g', patch: { name: '断网第二步' } }, { 'guest:g': 0 })
  const originalIds = (await storage.list('a')).map(v => v.command.operationId)
  setOffline(false); await repo.refresh()
  assert.deepEqual(executed, originalIds)
  assert.equal(repo.getSnapshot().status, 'synced')
  assert.equal((await transport.read()).data.guests.g.name, '断网第二步')
  await repo.refresh(); assert.deepEqual(executed, originalIds)
  repo.stop(); storage.close()
})

test('auto reconnect resolves a lost response by receipt without reexecuting the write', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let calls = 0
  const repo = projectRepository('a', storage, { ...transport, execute: async c => {
    calls++; await transport.execute(c); throw Error('LOST_RESPONSE')
  } }, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '只新增一次', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'unknown')
  await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'synced'); assert.equal(calls, 1)
  assert.deepEqual((await transport.read()).data.guestOrder, ['g'])
  repo.stop(); storage.close()
})

test('refresh never grants approval to reopened drafts or retries terminal conflicts', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: 'g', name: '先保留', group: '' }, {})
  repo.stop(); setOffline(false)
  let calls = 0
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  repo = projectRepository('a', storage, { ...transport, execute: async () => { calls++; throw new CommandError('CONFLICT') } }, exclusive)
  await repo.open(); await repo.refresh(); await repo.refresh()
  assert.equal(calls, 0); assert.equal(repo.getSnapshot().status, 'resume_required')
  await repo.resume(); assert.equal(calls, 1); assert.equal(repo.getSnapshot().status, 'conflict')
  await repo.refresh(); await repo.refresh(); assert.equal(calls, 1)
  assert.equal((await storage.list('a')).length, 1)
  repo.stop(); storage.close()
})

test('rejected offline batch shows confirmed cloud state and retains frozen dependent drafts', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let calls = 0
  const repo = projectRepository('a', storage, { ...transport, execute: async c => { calls++; return transport.execute(c) } }, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '原值', group: '' }, {})
  setOffline(true)
  await repo.dispatch('guest.update', { id: 'g', patch: { name: '离线第一步' } }, { 'guest:g': 0 })
  await repo.dispatch('guest.update', { id: 'g', patch: { phone: '00123' } }, { 'guest:g': 1 })
  const frozen = (await repo.readDrafts()).map(item => item.command)
  setOffline(false)
  await transport.execute({ projectId: 'a', dataEpoch: 'e', operationId: 'other-batch', commandVersion: 1, type: 'guest.update', payload: { id: 'g', patch: { name: '另一端的新值' } }, expectedRevisions: { 'guest:g': 0 } })
  const before = calls
  await repo.refresh()
  assert.equal(calls, before + 1)
  assert.equal(repo.getSnapshot().status, 'conflict')
  assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '另一端的新值')
  assert.notEqual(repo.getSnapshot().snapshot!.data.guests.g.phone, '00123')
  assert.equal(repo.getSnapshot().pending, 2)
  assert.deepEqual((await repo.readDrafts()).map(item => item.command), frozen)
  assert.throws(() => repo.captureExport('draft'), /DRAFT_EXPORT_UNAVAILABLE/)
  assert.equal(repo.captureExport().snapshot.data.guests.g.name, '另一端的新值')
  await repo.refresh(); assert.equal(calls, before + 1)
  repo.stop(); storage.close()
})

test('definitive rejection with failed refresh falls back to confirmed copy, never optimistic data', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let rejected = false
  const repo = projectRepository('a', storage, { ...transport,
    read: async () => { if (rejected) throw Error('OFFLINE'); return transport.read() },
    execute: async () => { rejected = true; throw new CommandError('INVALID_INPUT') },
  }, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '拒绝新增', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'failed')
  assert.equal(repo.getSnapshot().error, 'CONFIRMED_READ_FAILED')
  assert.deepEqual(repo.getSnapshot().snapshot!.data.guestOrder, [])
  assert.equal((await repo.readDrafts()).length, 1)
  repo.stop(); storage.close()
})

test('authorization lost while refreshing a rejected command hides confirmed and optimistic copies', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let rejected = false
  const repo = projectRepository('a', storage, { ...transport,
    read: async () => { if (rejected) throw new CommandError('FORBIDDEN'); return transport.read() },
    execute: async () => { rejected = true; throw new CommandError('CONFLICT') },
  }, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '不应可见', group: '' }, {})
  assert.equal(repo.getSnapshot().status, 'forbidden')
  assert.equal(repo.getSnapshot().snapshot, null)
  assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/)
  assert.equal((await repo.readDrafts()).length, 1)
  repo.stop(); storage.close()
})

test('reopened offline counts durable drafts without showing cached arrangements or sending', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: 'g', name: '离线未提交', group: '' }, {})
  const frozen = await repo.readDrafts(); repo.stop()
  let executions = 0
  repo = projectRepository('a', storage, { ...transport, execute: async c => { executions++; return transport.execute(c) } }, exclusive)
  await repo.open()
  assert.equal(repo.getSnapshot().pending, 1)
  assert.equal(repo.getSnapshot().snapshot, null)
  assert.equal(repo.getSnapshot().status, 'unknown')
  assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/)
  setOffline(false); await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'resume_required')
  assert.deepEqual(repo.getSnapshot().snapshot!.data.guestOrder, [])
  assert.deepEqual(await repo.readDrafts(), frozen)
  assert.equal(executions, 0)
  repo.stop(); storage.close()
})

test('paused reopened drafts recheck access and hide arrangements on revocation without replay', async () => {
  const { store, transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: 'g', name: '待恢复', group: '' }, {})
  repo.stop(); setOffline(false)
  repo = projectRepository('a', storage, transport, exclusive); await repo.open()
  const frozen = await repo.readDrafts()
  assert.equal(repo.getSnapshot().status, 'resume_required')
  store.projects.get('a')!.access.collaborationHash = hashSecret('revoked')
  await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'forbidden')
  assert.equal(repo.getSnapshot().snapshot, null)
  assert.deepEqual(await repo.readDrafts(), frozen)
  assert.throws(() => repo.captureExport(), /EXPORT_UNAVAILABLE/)
  assert.deepEqual(store.projects.get('a')!.current.data, emptyCore())
  repo.stop(); storage.close()
})

test('conflicted paused queue still checks authorization and detects a restored epoch', async () => {
  const { store, transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  let executions = 0
  const repo = projectRepository('a', storage, { ...transport, execute: async () => { executions++; throw new CommandError('CONFLICT') } }, exclusive)
  await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '冲突', group: '' }, {})
  const frozen = await repo.readDrafts()
  assert.equal(repo.getSnapshot().status, 'conflict')
  store.projects.get('a')!.current.dataEpoch = 'restored'
  await repo.refresh()
  assert.equal(repo.getSnapshot().error, 'PROJECT_REPLACED')
  assert.equal(repo.getSnapshot().snapshot!.dataEpoch, 'restored')
  assert.deepEqual(await repo.readDrafts(), frozen)
  store.projects.get('a')!.access.collaborationHash = hashSecret('revoked')
  await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'forbidden')
  assert.equal(executions, 1)
  assert.deepEqual(await repo.readDrafts(), frozen)
  repo.stop(); storage.close()
})

test('explicit current-value comparison reads cloud without replaying paused drafts', async () => {
  const { transport, setOffline } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  await repo.open(); setOffline(true)
  await repo.dispatch('guest.add', { id: 'g', name: '原草稿', group: '' }, {})
  const frozen = await repo.readDrafts()
  repo.stop(); setOffline(false)
  repo = projectRepository('a', storage, transport, exclusive)
  try {
    await repo.open()
    const current = await repo.readDraftCurrent()
    assert.deepEqual(current.data.guestOrder, [])
    assert.equal(repo.getSnapshot().status, 'resume_required')
    assert.deepEqual(await repo.readDrafts(), frozen)
    assert.equal(await transport.queryReceipt(frozen[0].command), null)
    current.data.config.title = '不得污染内部快照'
    assert.notEqual(repo.captureExport().snapshot.data.config.title, current.data.config.title)
  } finally { repo.stop(); storage.close() }
})

test('current-value comparison rechecks authorization and cannot return a retained shared cache after revocation', async () => {
  const { CommandError } = await import('../../src/fusion/protocol.ts')
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let revoked = false
  const repo = projectRepository('a', storage, { ...transport, read: async () => { if (revoked) throw new CommandError('FORBIDDEN'); return transport.read() } }, exclusive)
  try {
    await repo.open(); assert.ok(await storage.readConfirmed?.('a'))
    revoked = true
    await assert.rejects(repo.readDraftCurrent(), { code: 'FORBIDDEN' })
    assert.equal(repo.getSnapshot().snapshot, null)
    assert.equal(repo.getSnapshot().status, 'forbidden')
    assert.equal(await storage.readConfirmed?.('a'), undefined)
  } finally { repo.stop(); storage.close() }
})

test('retain-before-reedit preserves original conflicts and submits new intent with a new ID', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  try {
    await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '初始', group: '' }, {})
    await transport.execute({ projectId: 'a', dataEpoch: 'e', operationId: 'other', commandVersion: 1, type: 'guest.update', payload: { id: 'g', patch: { name: '另一设备修改' } }, expectedRevisions: { 'guest:g': 0 } })
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '原冲突意图' } }, { 'guest:g': 0 })
    const original = await repo.readDrafts()
    await repo.discardDrafts(original, true)
    assert.equal(repo.getSnapshot().status, 'synced')
    assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '另一设备修改')
    assert.deepEqual((await repo.readDraftArchives())[0].drafts, original)
    assert.equal(await transport.queryReceipt(original[0].command), null)
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '核对后的新意图' } }, { 'guest:g': 1 })
    assert.equal(repo.getSnapshot().status, 'synced')
    assert.equal((await transport.read()).data.guests.g.name, '核对后的新意图')
    assert.deepEqual((await repo.readDraftArchives())[0].drafts, original)
    assert.equal(await transport.queryReceipt(original[0].command), null)
  } finally { repo.stop(); storage.close() }
})
test('retain-before-reedit cannot bypass unknown results', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, { ...transport, execute: async () => { throw Error('UNKNOWN') } }, exclusive)
  try {
    await repo.open(); await repo.dispatch('guest.add', { id: 'g', name: '未定', group: '' }, {})
    const frozen = await repo.readDrafts()
    await assert.rejects(repo.discardDrafts(frozen, true), /RESULT_STILL_UNKNOWN/)
    assert.deepEqual(await repo.readDrafts(), frozen); assert.deepEqual(await repo.readDraftArchives(), [])
  } finally { repo.stop(); storage.close() }
})

test('a retained version-name form uses its original operation ID after command success and failed form cleanup', async () => {
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const transport = gatewayTransport('a', secret, probeGateway(store, ['a']))
  const storage = await openIndexedDbOutbox(new IDBFactory())
  let repo = projectRepository('a', storage, transport, exclusive)
  try {
    await repo.open()
    const id = crypto.randomUUID(), expected = { snapshot: 0, notes: 0 }
    assert.equal(await repo.dispatch('version.save', { name: '确认版' }, expected, 'e', id), true)
    assert.equal(repo.getSnapshot().status, 'synced')
    // Simulate process loss before the private name form was removed.
    repo.stop(); repo = projectRepository('a', storage, transport, exclusive); await repo.open()
    assert.equal(await repo.dispatch('version.save', { name: '确认版' }, expected, 'e', id), true)
    assert.equal(repo.getSnapshot().status, 'synced')
    assert.equal((await repo.readHistory()).versions.filter(v => v.kind === 'manual').length, 1)
    const frozen = { projectId: 'a', dataEpoch: 'e', operationId: id, commandVersion: 1 as const, type: 'version.save', payload: { name: '确认版' }, expectedRevisions: expected }
    assert.ok(await transport.queryReceipt(frozen))
  } finally { repo.stop(); storage.close() }
})


test('room local-save notification precedes a delayed cloud response', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const execute = transport.execute
  transport.execute = async command => { await gate; return execute(command) }
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  let prepared!: () => void
  const local = new Promise<void>(resolve => { prepared = resolve })
  const completed = repo.dispatch('room.add', { id: 'slow-room', label: '01', type: '大床房' }, {}, undefined, undefined, prepared)
  try {
    await Promise.race([local, new Promise<never>((_, reject) => setTimeout(() => reject(Error('LOCAL_SAVE_NOTIFICATION_TIMEOUT')), 1000))])
    assert.equal(repo.getSnapshot().snapshot!.data.rooms['slow-room'].label, '01')
    assert.equal((await storage.list('a')).length, 1)
    assert.equal((await transport.read()).data.rooms['slow-room'], undefined)
  } finally { release(); await completed; repo.stop(); storage.close() }
})


test('local-save notification is not emitted if durable insertion fails', async () => {
  const { transport } = setup(), storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, exclusive)
  await repo.open()
  storage.insert = async () => { throw Error('FICTITIOUS_LOCAL_FAILURE') }
  let notified = false
  assert.equal(await repo.dispatch('room.add', { id: 'failed-room', label: '01', type: '大床房' }, {}, undefined, undefined, () => { notified = true }), false)
  assert.equal(notified, false)
  assert.equal(repo.getSnapshot().status, 'local_error')
  assert.equal(repo.getSnapshot().snapshot!.data.rooms['failed-room'], undefined)
  repo.stop(); storage.close()
})
