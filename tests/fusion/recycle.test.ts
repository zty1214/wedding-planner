import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from './memoryStore.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { recycleService } from '../../server/fusion/recycleService.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Core } from '../../src/fusion/core.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
async function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  let date = new Date('2026-10-04T12:00:00Z')
  const service = commandService(store, coreHandlers(), () => date), recycle = recycleService(store, () => date)
  const cmd = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  const send = (type: string, payload: Json, rev = {}) => service.execute(cmd(type, payload, rev), 'secret')
  await send('guest.add', { id: 'g', name: '宾客', group: '' })
  await send('table.add', { id: 't', label: '一桌', seats: 2, x: 0, y: 0 })
  await send('guest.assign', { id: 'g', tableId: 't', seatIndex: 0 }, { 'guest:g': 0, 'table:t': 0 })
  return { store, recycle, cmd, send, later: () => { date = new Date('2026-11-03T12:00:00Z') } }
}
test('delete table and affected associations are atomic and restore once with higher revisions', async () => {
  const { store, recycle, cmd, send } = await setup()
  const deletion = cmd('table.deleteWithGuests', { id: 't' }, { 'table:t': 0, 'guest:g': 1 })
  await recycle.execute(deletion, 'secret'); await recycle.execute(deletion, 'secret')
  const record = (await recycle.list('a', 'secret')).records[0]
  assert.equal((await recycle.list('a', 'secret')).records.length, 1)
  let core = store.projects.get('a')!.current.data as Core
  assert.equal(core.guests.g.tableId, null); assert.equal(core.tables.t, undefined)
  await assert.rejects(send('table.add', { id: 't', label: '复用ID', seats: 2, x: 0, y: 0 }), { code: 'CONFLICT' })
  const restore = cmd('recycle.restore', { id: record.id }, { 'guest:g': 2 })
  await recycle.execute(restore, 'secret'); await recycle.execute(restore, 'secret')
  core = store.projects.get('a')!.current.data as Core
  assert.equal(core.guests.g.tableId, 't'); assert.equal(core.guests.g.revision, 3); assert.equal(core.tables.t.revision, 1)
  assert.deepEqual(core.tableOrder, ['t'])
  assert.equal((await recycle.list('a', 'secret')).records.length, 0)
  await assert.rejects(recycle.execute(cmd('recycle.restore', { id: record.id }, { 'guest:g': 3 }), 'secret'), { code: 'CONFLICT' })
})
test('changed affected set, receipt failure and expired restore cannot partially alter data', async () => {
  const { store, recycle, cmd, later } = await setup()
  await assert.rejects(recycle.execute(cmd('table.deleteWithGuests', { id: 't' }, { 'table:t': 0 }), 'secret'), { code: 'CONFLICT' })
  const before = structuredClone(store.projects.get('a'))
  store.failReceipt = true
  await assert.rejects(recycle.execute(cmd('guest.delete', { id: 'g' }, { 'guest:g': 1 }), 'secret'))
  assert.deepEqual(store.projects.get('a'), before)
  store.failReceipt = false
  const d = cmd('guest.delete', { id: 'g' }, { 'guest:g': 1 }); await recycle.execute(d, 'secret')
  later()
  assert.equal((await recycle.list('a', 'secret')).records.length, 0)
  await assert.rejects(recycle.execute(cmd('recycle.restore', { id: d.operationId }), 'secret'), { code: 'CONFLICT' })
})
test('restoring deleted guest never takes an occupied seat from another person', async () => {
  const { store, recycle, cmd, send } = await setup()
  const d = cmd('guest.delete', { id: 'g' }, { 'guest:g': 1 }); await recycle.execute(d, 'secret')
  await send('guest.add', { id: 'other', name: '后来宾客', group: '' })
  await send('guest.assign', { id: 'other', tableId: 't', seatIndex: 0 }, { 'guest:other': 0, 'table:t': 0 })
  const before = structuredClone(store.projects.get('a'))
  await assert.rejects(recycle.execute(cmd('recycle.restore', { id: d.operationId }), 'secret'), { code: 'CONFLICT' })
  assert.deepEqual(store.projects.get('a'), before)
})

test('removing a stay night checks affected guests and restores dates atomically', async () => {
  const { store, recycle, cmd, send } = await setup()
  const { assertRecycleRecord, previewRestore } = await import('../../src/fusion/recycle.ts')
  await send('room.add', { id: 'r', label: '房间', type: '标间' })
  await send('stayDate.add', { date: '2027-01-01' }, { config: 0 })
  await send('stayDate.add', { date: '2027-01-02' }, { config: 1 })
  await send('guest.assignRoom', { id: 'g', roomId: 'r' }, { 'guest:g': 1, 'room:r': 0 })
  await send('guest.setStayDates', { id: 'g', dates: ['2027-01-01', '2027-01-02'] }, { 'guest:g': 2, config: 2 })
  const original = structuredClone(store.projects.get('a'))
  await assert.rejects(recycle.execute(cmd('stayDate.remove', { date: '2027-01-01' }, { config: 2 }), 'secret'), { code: 'CONFLICT' })
  assert.deepEqual(store.projects.get('a'), original)
  const deletion = cmd('stayDate.remove', { date: '2027-01-01' }, { config: 2, 'guest:g': 3 })
  store.failReceipt = true
  await assert.rejects(recycle.execute(deletion, 'secret'))
  assert.deepEqual(store.projects.get('a'), original)
  store.failReceipt = false
  const receipt = await recycle.execute(deletion, 'secret')
  assert.deepEqual(await recycle.execute(deletion, 'secret'), receipt)
  const core = store.projects.get('a')!.current.data as Core
  assert.deepEqual(core.config.stayDates, ['2027-01-02'])
  assert.deepEqual(core.guests.g.stayDates, ['2027-01-02'])
  assert.equal(core.guests.g.roomId, 'r'); assert.equal(core.guests.g.tableId, 't')
  const record = (await recycle.list('a', 'secret')).records[0]
  assert.doesNotThrow(() => assertRecycleRecord(record))
  const revisions = previewRestore(core, record)
  await recycle.execute(cmd('recycle.restore', { id: record.id }, revisions), 'secret')
  const restored = store.projects.get('a')!.current.data as Core
  assert.deepEqual(restored.config.stayDates, ['2027-01-01', '2027-01-02'])
  assert.deepEqual(restored.guests.g.stayDates, ['2027-01-01', '2027-01-02'])
  assert.equal(restored.guests.g.revision, 5); assert.equal(restored.config.revision, 4)
})

test('stay-date restore refuses subsequent guest edits without overwriting them', async () => {
  const { store, recycle, cmd, send } = await setup()
  await send('room.add', { id: 'r', label: '房间', type: '标间' })
  await send('stayDate.add', { date: '2027-01-01' }, { config: 0 })
  await send('guest.assignRoom', { id: 'g', roomId: 'r' }, { 'guest:g': 1, 'room:r': 0 })
  await send('guest.setStayDates', { id: 'g', dates: ['2027-01-01'] }, { 'guest:g': 2, config: 1 })
  const deletion = cmd('stayDate.remove', { date: '2027-01-01' }, { config: 1, 'guest:g': 3 })
  await recycle.execute(deletion, 'secret')
  await send('guest.update', { id: 'g', patch: { notes: '后来修改' } }, { 'guest:g': 4 })
  const before = structuredClone(store.projects.get('a'))
  await assert.rejects(recycle.execute(cmd('recycle.restore', { id: deletion.operationId }, { config: 2, 'guest:g': 5 }), 'secret'), { code: 'CONFLICT' })
  assert.deepEqual(store.projects.get('a'), before)
})

test('not needing accommodation is independent of seating and can recover existing stay', async () => {
  const { store, recycle, cmd, send } = await setup()
  await send('guest.setStayNeed', { id: 'g', stayNeed: 'not_needed' }, { 'guest:g': 1 })
  let core = store.projects.get('a')!.current.data as Core
  assert.equal(core.guests.g.tableId, 't'); assert.equal(core.guests.g.stayNeed, 'not_needed')
  assert.equal((await recycle.list('a', 'secret')).records.length, 0)
  await send('room.add', { id: 'r', label: '房间', type: '标间' })
  await send('guest.assignRoom', { id: 'g', roomId: 'r' }, { 'guest:g': 2, 'room:r': 0 })
  await assert.rejects(send('guest.setStayNeed', { id: 'g', stayNeed: 'not_needed' }, { 'guest:g': 3 }), { code: 'INVALID_INPUT' })
  const deletion = cmd('guest.clearStayNeed', { id: 'g' }, { 'guest:g': 3 })
  await recycle.execute(deletion, 'secret')
  core = store.projects.get('a')!.current.data as Core
  assert.equal(core.guests.g.roomId, null); assert.equal(core.guests.g.stayNeed, 'not_needed')
  assert.equal(core.guests.g.tableId, 't')
  await recycle.execute(cmd('recycle.restore', { id: deletion.operationId }, { 'guest:g': 4 }), 'secret')
  core = store.projects.get('a')!.current.data as Core
  assert.equal(core.guests.g.roomId, 'r'); assert.equal(core.guests.g.stayNeed, 'needed')
})
