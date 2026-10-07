import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { emptyCore } from '../../src/fusion/core.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { buildExportWorkbook } from '../../src/fusion/exportWorkbook.ts'
import { seatingExportModel } from '../../src/fusion/seatingExport.ts'
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
  return { repo, remote, storage, store, transport, setOffline: (value: boolean) => { offline = value }, setQuota: () => { quota = true } }
}

test('reopened queue exports dependent edits without sending or modifying the original commands', async () => {
  const { repo, storage, remote, transport, setOffline } = await setup()
  try {
    setOffline(true)
    assert.equal(await repo.dispatch('table.deleteWithGuests', { id: 't' }, { 'table:t': 0, 'guest:g': 0 }), true)
    assert.equal(await repo.dispatch('guest.update', { id: 'g', patch: { name: '恢复后草稿' } }, { 'guest:g': 1 }), true)
    const before = await repo.readDrafts()
    repo.stop(); setOffline(false)
    const reopened = projectRepository('a', storage, transport, async (_key, body) => body())
    await reopened.open()
    assert.equal(reopened.getSnapshot().status, 'resume_required')
    const exported = await reopened.captureRecoveredDraft()
    assert.equal(exported.source, 'draft')
    assert.equal(exported.snapshot.data.guests.g.name, '恢复后草稿')
    assert.equal(exported.snapshot.data.guests.g.tableId, null)
    assert.deepEqual(exported.snapshot.data.tableOrder, [])
    assert.deepEqual(await reopened.readDrafts(), before)
    assert.equal(reopened.getSnapshot().status, 'resume_required')
    assert.equal((await remote.read()).data.guests.g.name, '虚构宾客')
    assert.equal(reopened.captureExport().snapshot.data.guests.g.name, '虚构宾客')
    for (const p of before) assert.equal(await remote.queryReceipt(p.command), null)
    reopened.stop()
  } finally { repo.stop(); storage.close() }
})
test('recovered export skips a committed lost-response request before projecting its dependent edit', async () => {
  const { repo, storage, remote, setOffline } = await setup()
  try {
    setOffline(true)
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '已成功原操作' } }, { 'guest:g': 0 })
    await repo.dispatch('guest.update', { id: 'g', patch: { phone: '0012345' } }, { 'guest:g': 1 })
    const before = await repo.readDrafts()
    await remote.execute(before[0].command)
    setOffline(false)
    const value = await repo.captureRecoveredDraft()
    assert.equal(value.snapshot.data.guests.g.name, '已成功原操作')
    assert.equal(value.snapshot.data.guests.g.phone, '0012345')
    assert.equal(value.snapshot.data.guests.g.revision, 2)
    assert.equal((await remote.read()).data.guests.g.revision, 1)
    assert.deepEqual(await repo.readDrafts(), before)
  } finally { repo.stop(); storage.close() }
})
test('recovered export refuses concurrent edits and old epochs without rebasing or deleting drafts', async () => {
  const { repo, storage, remote, store, setOffline } = await setup()
  try {
    setOffline(true)
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '本机草稿' } }, { 'guest:g': 0 })
    const before = await repo.readDrafts()
    await remote.execute({ ...before[0].command, operationId: 'other', payload: { id: 'g', patch: { name: '另一端' } } })
    setOffline(false)
    await assert.rejects(repo.captureRecoveredDraft(), /CONFLICT/)
    store.projects.get('a')!.current.dataEpoch = 'replacement'
    await assert.rejects(repo.captureRecoveredDraft(), /PROJECT_REPLACED/)
    assert.deepEqual(await repo.readDrafts(), before)
  } finally { repo.stop(); storage.close() }
})
test('recovered export refuses offline authorization and changed local batches', async () => {
  const { repo, storage, transport, setOffline } = await setup()
  try {
    setOffline(true)
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '原草稿' } }, { 'guest:g': 0 })
    await assert.rejects(repo.captureRecoveredDraft(), /OFFLINE/)
    setOffline(false)
    const before = await repo.readDrafts()
    const raced = projectRepository('a', storage, { ...transport, queryReceipt: async () => {
      await storage.setStatus('a', 'e', before[0].command.operationId, 'conflict'); return null
    } }, async (_key, body) => body())
    await raced.open()
    await assert.rejects(raced.captureRecoveredDraft(), /DRAFTS_CHANGED/)
    assert.equal((await raced.readDrafts()).length, 1)
    raced.stop()
  } finally { repo.stop(); storage.close() }
})
test('recovered export refuses missing recovery records and legacy ordering, and hides data on revoked access', async () => {
  const { repo, storage, transport, store } = await setup()
  try {
    const command = { projectId: 'a', dataEpoch: 'e', operationId: 'restore', commandVersion: 1 as const, type: 'recycle.restore', payload: { id: 'missing' }, expectedRevisions: {} }
    await storage.insert({ command, status: 'prepared' })
    await assert.rejects(repo.captureRecoveredDraft(), /CONFLICT/)
    const legacy = projectRepository('a', { ...storage, list: async id => (await storage.list(id)).map(({ sequence: _sequence, ...item }) => item) }, transport, async (_key, body) => body())
    await legacy.open()
    await assert.rejects(legacy.captureRecoveredDraft(), /DRAFT_ORDER_UNKNOWN/)
    store.projects.get('a')!.access.collaborationHash = 'revoked'
    await assert.rejects(repo.captureRecoveredDraft(), /FORBIDDEN/)
    assert.equal(repo.getSnapshot().snapshot, null)
    assert.equal((await storage.list('a')).length, 1)
    legacy.stop()
  } finally { repo.stop(); storage.close() }
})

for (const kind of ['table', 'note'] as const) test(`reopened ${kind} recycling projects the complete arrangement without consuming the recovery record`, async () => {
  const { repo, storage, remote, transport, setOffline } = await setup()
  try {
    if (kind === 'note') await repo.dispatch('note.add', { id: 'n', title: '原笔记', content: '原正文', category: '其他' }, {})
    await repo.dispatch(kind === 'table' ? 'table.deleteWithGuests' : 'note.delete', { id: kind === 'table' ? 't' : 'n' }, kind === 'table' ? { 'table:t': 0, 'guest:g': 0 } : { 'note:n': 0 })
    const record = (await remote.readRecycle!()).records[0]
    setOffline(true)
    await repo.dispatch('recycle.restore', { id: record.id }, kind === 'table' ? { 'guest:g': 1 } : {})
    const before = await repo.readDrafts()
    repo.stop(); setOffline(false)
    const reopened = projectRepository('a', storage, transport, async (_key, body) => body())
    await reopened.open()
    const projected = (await reopened.captureRecoveredDraft()).snapshot
    if (kind === 'table') {
      assert.equal(projected.data.tables.t.label, '桌一')
      assert.equal(projected.data.guests.g.tableId, 't')
      assert.equal(projected.data.guests.g.seatIndex, 0)
      assert.equal((await remote.read()).data.tableOrder.length, 0)
    } else {
      assert.equal(projected.notes?.[0].content, '原正文')
      assert.equal((await remote.read()).notes?.length, 0)
    }
    assert.deepEqual(await reopened.readDrafts(), before)
    assert.deepEqual((await remote.readRecycle!()).records, [record])
    await reopened.resume()
    const actual = await remote.read()
    assert.deepEqual(projected.data, actual.data)
    assert.deepEqual(projected.notes?.map(({ updatedAt: _time, ...n }) => n), actual.notes?.map(({ updatedAt: _time, ...n }) => n))
    assert.equal(projected.notesRevision, actual.notesRevision)
    assert.equal(reopened.getSnapshot().status, 'synced')
    reopened.stop()
  } finally { repo.stop(); storage.close() }
})
for (const alreadyCommitted of [false, true]) test(`whole-project recovery export handles ${alreadyCommitted ? 'lost successful response' : 'unsubmitted target'} without writing`, async () => {
  const { repo, storage, remote, transport, store, setOffline } = await setup()
  try {
    store.projects.get('a')!.access.managementHash = hashSecret('a'.repeat(64))
    await repo.refresh()
    await repo.dispatch('note.add', { id: 'restore-note', title: '目标笔记', content: '目标正文', category: '其他' }, {})
    await repo.dispatch('version.save', { name: '恢复目标' }, { snapshot: 0, notes: 1 })
    const target = (await remote.readHistory!()).versions[0]
    await repo.dispatch('guest.update', { id: 'g', patch: { name: '后来姓名' } }, { 'guest:g': 0 })
    await repo.dispatch('note.update', { id: 'restore-note', title: '后来笔记', content: '后来正文', category: '其他' }, { 'note:restore-note': 0 })
    const base = await remote.read()
    setOffline(true)
    await repo.dispatch('version.restore', { id: target.id }, { snapshot: base.snapshotRevision, notes: base.notesRevision! })
    const original = await repo.readDrafts()
    if (alreadyCommitted) await remote.execute(original[0].command)
    repo.stop(); setOffline(false)
    const reopened = projectRepository('a', storage, transport, async (_key, body) => body())
    await reopened.open()
    const cloudBefore = await remote.read(), historyBefore = await remote.readHistory!()
    const result = await reopened.captureRecoveredDraft()
    assert.equal(result.snapshot.data.guests.g.name, '虚构宾客')
    assert.equal(result.source, 'draft')
    assert.equal(result.snapshot.notes?.[0].content, '目标正文')
    if (!alreadyCommitted) {
      assert.match(buildExportWorkbook(result, 'guests').workbook.Props!.Subject!, /待恢复目标.*尚未执行恢复/)
      assert.match(seatingExportModel(result).provenance, /待恢复草稿/)
    }
    assert.equal(result.restoreTarget?.id, alreadyCommitted ? undefined : target.id)
    assert.deepEqual(await remote.read(), cloudBefore)
    assert.deepEqual(await remote.readHistory!(), historyBefore)
    assert.deepEqual(await reopened.readDrafts(), original)
    if (!alreadyCommitted) {
      await remote.execute({ ...original[0].command, operationId: 'concurrent', type: 'guest.update', payload: { id: 'g', patch: { phone: '001' } }, expectedRevisions: { 'guest:g': 1 } })
      await assert.rejects(reopened.captureRecoveredDraft(), /CONFLICT/)
    }
    reopened.stop()
  } finally { repo.stop(); storage.close() }
})
