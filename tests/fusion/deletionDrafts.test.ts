import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { emptyCore } from '../../src/fusion/core.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import type { Json } from '../../src/fusion/protocol.ts'
import { MemoryStore } from './memoryStore.ts'

async function setup() {
  const core = emptyCore(), store = new MemoryStore(), secret = 'a'.repeat(64)
  core.config.stayDates = ['2026-10-06', '2026-10-07']
  core.tables.t = { id: 't', revision: 0, label: '桌一', seats: 8, x: 0, y: 0, rotation: 0 }; core.tableOrder = ['t']
  core.rooms.r = { id: 'r', revision: 0, label: '标间一', type: '标间', notes: '' }; core.roomOrder = ['r']
  core.guests.g = { id: 'g', revision: 0, name: '虚构宾客', group: '', phone: '', notes: '', side: 'unset', attendance: 'confirmed', tableId: 't', seatIndex: 0, roomId: 'r', stayNeed: 'needed', stayDates: [...core.config.stayDates] }; core.guestOrder = ['g']
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: core })
  const storage = await openIndexedDbOutbox(new IDBFactory()), remote = gatewayTransport('a', secret, probeGateway(store, ['a']))
  let offline = false, quota = false
  const transport = { ...remote, execute: async (c: Parameters<typeof remote.execute>[0]) => { if (offline) throw Error('OFFLINE'); return remote.execute(c) }, queryReceipt: async (c: Parameters<typeof remote.queryReceipt>[0]) => { if (offline) throw Error('OFFLINE'); return remote.queryReceipt(c) }, read: async () => { if (offline) throw Error('OFFLINE'); return remote.read() } }
  const repo = projectRepository('a', { ...storage, insert: async item => { if (quota) throw Error('QUOTA'); await storage.insert(item) } }, transport, async (_key, body) => body())
  await repo.open()
  return { repo, remote, storage, store, setOffline: (value: boolean) => { offline = value }, setQuota: () => { quota = true } }
}
const scenarios: { type: string; payload: Json; revisions: Record<string, number>; check(data: ReturnType<typeof emptyCore>): void }[] = [
  { type: 'guest.delete', payload: { id: 'g' }, revisions: { 'guest:g': 0 }, check: c => { assert.deepEqual(c.guestOrder, []); assert.equal(c.guests.g, undefined) } },
  { type: 'table.deleteWithGuests', payload: { id: 't' }, revisions: { 'table:t': 0, 'guest:g': 0 }, check: c => { assert.deepEqual(c.tableOrder, []); assert.equal(c.guests.g.tableId, null); assert.equal(c.guests.g.seatIndex, null); assert.equal(c.guests.g.attendance, 'confirmed') } },
  { type: 'room.deleteWithAssignments', payload: { id: 'r' }, revisions: { 'room:r': 0, 'guest:g': 0 }, check: c => { assert.deepEqual(c.roomOrder, []); assert.equal(c.guests.g.roomId, null); assert.deepEqual(c.guests.g.stayDates, []); assert.equal(c.guests.g.stayNeed, 'needed') } },
  { type: 'guest.clearRoom', payload: { id: 'g' }, revisions: { 'guest:g': 0 }, check: c => { assert.equal(c.guests.g.roomId, null); assert.deepEqual(c.guests.g.stayDates, []); assert.equal(c.guests.g.stayNeed, 'needed') } },
  { type: 'guest.clearStayNeed', payload: { id: 'g' }, revisions: { 'guest:g': 0 }, check: c => { assert.equal(c.guests.g.roomId, null); assert.deepEqual(c.guests.g.stayDates, []); assert.equal(c.guests.g.stayNeed, 'not_needed') } },
  { type: 'stayDate.remove', payload: { date: '2026-10-06' }, revisions: { config: 0, 'guest:g': 0 }, check: c => { assert.deepEqual(c.config.stayDates, ['2026-10-07']); assert.deepEqual(c.guests.g.stayDates, ['2026-10-07']) } },
]
for (const scenario of scenarios) test(`offline ${scenario.type} projects dependent changes and matches atomic server replay`, async () => {
  const { repo, remote, storage, setOffline } = await setup()
  try {
    const before = repo.captureExport().snapshot.data
    setOffline(true)
    assert.equal(await repo.dispatch(scenario.type, scenario.payload, scenario.revisions), true)
    scenario.check(repo.getSnapshot().snapshot!.data)
    assert.deepEqual(repo.captureExport().snapshot.data, before)
    if (scenario.type !== 'guest.delete') {
      const guest = repo.getSnapshot().snapshot!.data.guests.g
      assert.equal(guest.revision, 1)
      assert.equal(await repo.dispatch('guest.update', { id: 'g', patch: { name: '删除后继续编辑' } }, { 'guest:g': guest.revision }), true)
    }
    const draft = repo.captureExport('draft').snapshot.data
    const commands = await repo.readDrafts()
    setOffline(false); await repo.resume()
    assert.equal(repo.getSnapshot().status, 'synced')
    assert.deepEqual((await remote.read()).data, draft)
    for (const item of commands) assert.ok(await remote.queryReceipt(item.command))
    assert.equal((await remote.readRecycle!()).records.length, 1)
  } finally { repo.stop(); storage.close() }
})
test('offline note deletion preserves other notes and uses the server notes revision', async () => {
  const { repo, remote, storage, setOffline } = await setup()
  try {
    for (const id of ['n1', 'n2']) assert.equal(await repo.dispatch('note.add', { id, title: id, content: '虚构笔记', category: '其他' }, {}), true)
    const before = repo.captureExport().snapshot
    setOffline(true)
    assert.equal(await repo.dispatch('note.delete', { id: 'n1' }, { 'note:n1': 0 }), true)
    const draft = repo.captureExport('draft').snapshot
    assert.deepEqual(draft.notes?.map(n => n.id), ['n2'])
    assert.equal(draft.notesRevision, before.notesRevision! + 1)
    assert.deepEqual(repo.captureExport().snapshot, before)
    setOffline(false); await repo.resume()
    const actual = await remote.read()
    assert.deepEqual(actual.notes, draft.notes); assert.equal(actual.notesRevision, draft.notesRevision)
    assert.equal((await remote.readRecycle!()).records[0].type, 'note.delete')
  } finally { repo.stop(); storage.close() }
})
test('failed local deletion persistence preserves the displayed arrangement and creates no queue', async () => {
  const { repo, storage, setQuota } = await setup()
  try {
    const before = repo.getSnapshot().snapshot
    setQuota()
    assert.equal(await repo.dispatch('guest.delete', { id: 'g' }, { 'guest:g': 0 }), false)
    assert.deepEqual(repo.getSnapshot().snapshot, before)
    assert.deepEqual(await repo.readDrafts(), [])
  } finally { repo.stop(); storage.close() }
})
test('a remotely edited guest blocks table deletion and its dependent edits without erasing drafts', async () => {
  const { repo, remote, storage, setOffline } = await setup()
  try {
    setOffline(true)
    assert.equal(await repo.dispatch('table.deleteWithGuests', { id: 't' }, { 'table:t': 0, 'guest:g': 0 }), true)
    assert.equal(await repo.dispatch('guest.update', { id: 'g', patch: { name: '删除后的本机姓名' } }, { 'guest:g': 1 }), true)
    const original = (await repo.readDrafts()).map(item => item.command)
    await remote.execute({ projectId: 'a', dataEpoch: 'e', operationId: 'other-client', commandVersion: 1, type: 'guest.update', payload: { id: 'g', patch: { phone: '00123' } }, expectedRevisions: { 'guest:g': 0 } })
    setOffline(false); await repo.resume()
    assert.equal(repo.getSnapshot().status, 'conflict')
    assert.equal(repo.getSnapshot().snapshot!.data.guests.g.tableId, 't')
    assert.equal(repo.getSnapshot().snapshot!.data.guests.g.phone, '00123')
    assert.equal(repo.getSnapshot().snapshot!.data.guests.g.name, '虚构宾客')
    assert.deepEqual((await repo.readDrafts()).map(item => item.command), original)
    assert.throws(() => repo.captureExport('draft'), /DRAFT_EXPORT_UNAVAILABLE/)
    assert.equal((await remote.readRecycle!()).records.length, 0)
    for (const command of original) assert.equal(await remote.queryReceipt(command), null)
  } finally { repo.stop(); storage.close() }
})
