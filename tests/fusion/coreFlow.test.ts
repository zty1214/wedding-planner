import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { randomUUID } from 'node:crypto'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Core } from '../../src/fusion/core.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { durableOutbox } from '../../src/fusion/outbox.ts'
import { MemoryStore } from './memoryStore.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('collab'), managementHash: hashSecret('manager') }, { dataEpoch: 'e1', snapshotRevision: 0, data: emptyCore() })
  const service = commandService(store, coreHandlers())
  const cmd = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e1', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  const send = (type: string, payload: Json, revisions = {}) => service.execute(cmd(type, payload, revisions), 'collab')
  const read = async () => (await service.read('a', 'collab'))!.data as Core
  return { store, service, cmd, send, read }
}
test('main flow persists seating, table coordinates and independent per-person nights through durable queue', async () => {
  const { service, cmd, send, read } = setup()
  await send('table.add', { id: 't', label: '一桌', seats: 10, x: 20, y: 30 })
  await send('room.add', { id: 'r', label: '101', type: '标间' })
  await send('stayDate.add', { date: '2027-01-01' }, { config: 0 })
  await send('stayDate.add', { date: '2027-01-02' }, { config: 1 })
  for (const id of ['g1', 'g2']) await send('guest.add', { id, name: '小明', group: '朋友' })
  const factory = new IDBFactory()
  let storage = await openIndexedDbOutbox(factory)
  const transport = { queryReceipt: (c: Command) => service.queryReceipt(c.projectId, c.dataEpoch, c.operationId, 'collab'),
    execute: async (c: Command) => { await service.execute(c, 'collab'); throw Error('RESPONSE_LOST') } }
  let outbox = durableOutbox(storage, transport)
  const assignment = cmd('guest.assign', { id: 'g1', tableId: 't', seatIndex: 0 }, { 'guest:g1': 0, 'table:t': 0 })
  await outbox.prepare(assignment)
  assert.equal((await outbox.send('a', 'e1', assignment.operationId)).status, 'result_unknown')
  storage.close(); storage = await openIndexedDbOutbox(factory); outbox = durableOutbox(storage, transport)
  // Explicit retry after reopening: receipt resolves the previous commit without a second execution.
  assert.equal((await outbox.send('a', 'e1', assignment.operationId)).status, 'synced')
  assert.equal((await storage.list('a', 'e1')).length, 0)
  for (const [id, rev, night] of [['g1', 1, '2027-01-01'], ['g2', 0, '2027-01-02']] as const) {
    await send('guest.assignRoom', { id, roomId: 'r' }, { [`guest:${id}`]: rev, 'room:r': 0 })
    await send('guest.setStayDates', { id, dates: [night, night] }, { [`guest:${id}`]: rev + 1, config: 2 })
  }
  await send('table.move', { id: 't', x: 170, y: 220 }, { 'table:t': 0 })
  const state = await read()
  assert.deepEqual(state.guests.g1.stayDates, ['2027-01-01']); assert.deepEqual(state.guests.g2.stayDates, ['2027-01-02'])
  assert.equal(state.guests.g1.seatIndex, 0); assert.equal(state.tables.t.x, 170)
  assert.equal(state.guests.g1.revision, 3)
  storage.close()
})
test('same-seat concurrency has one winner; independent edits succeed and attendance survives moves', async () => {
  const { send, read } = setup()
  await send('table.add', { id: 't', label: '一桌', seats: 2, x: 0, y: 0 })
  for (const id of ['a', 'b']) await send('guest.add', { id, name: id, group: '' })
  const results = await Promise.allSettled(['a', 'b'].map(id => send('guest.assign', { id, tableId: 't', seatIndex: 0 }, { [`guest:${id}`]: 0, 'table:t': 0 })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'SEAT_OCCUPIED')
  await Promise.all([send('guest.update', { id: 'a', patch: { attendance: 'confirmed' } }, { 'guest:a': 1 }), send('guest.update', { id: 'b', patch: { name: 'B' } }, { 'guest:b': 0 })])
  await send('guest.unassign', { id: 'a' }, { 'guest:a': 2 })
  assert.equal((await read()).guests.a.attendance, 'confirmed')
  await assert.rejects(send('guest.update', { id: 'b', patch: { name: 'stale' } }, { 'guest:b': 0 }), { code: 'CONFLICT' })
})
test('invalid references, invalid dates and arbitrary patch fields cannot bypass business commands', async () => {
  const { send, read } = setup()
  await send('guest.add', { id: 'g', name: 'guest', group: '' })
  const badPatches: Json[] = [{ tableId: 't' }, { revision: 99 }, { id: 'other' }]
  for (const patch of badPatches) await assert.rejects(send('guest.update', { id: 'g', patch }, { 'guest:g': 0 }), { code: 'INVALID_INPUT' })
  await assert.rejects(send('stayDate.add', { date: '2027-02-29' }, { config: 0 }), { code: 'INVALID_INPUT' })
  await assert.rejects(send('guest.assignRoom', { id: 'g', roomId: 'missing' }, { 'guest:g': 0 }), { code: 'NOT_FOUND' })
  await assert.rejects(send('guest.add', { id: '__proto__', name: 'bad', group: '' }), { code: 'INVALID_INPUT' })
  assert.equal((await read()).guests.g.revision, 0)
})

test('shared side is preserved; malformed stored core cannot produce successful no-op receipts', async () => {
  const { send, read, store } = setup()
  await send('guest.add', { id: 'g', name: '双方朋友', group: '朋友' })
  await send('guest.update', { id: 'g', patch: { side: 'shared' } }, { 'guest:g': 0 })
  assert.equal((await read()).guests.g.side, 'shared')
  const original = structuredClone(store.projects.get('a')!)
  const badStates: Json[] = [
    { ...emptyCore(), guests: [] },
    { ...emptyCore(), tables: true },
    { ...emptyCore(), config: { ...emptyCore().config, stayDates: ['2027-02-29'] } },
    { ...await read(), guests: { g: { ...(await read()).guests.g, roomId: 'missing' } } },
  ]
  for (const bad of badStates) {
    store.projects.get('a')!.current.data = bad
    await assert.rejects(send('guest.add', { id: 'another', name: '新宾客', group: '' }), { code: 'INVALID_INPUT' })
    assert.equal(store.projects.get('a')!.receipts.size, original.receipts.size)
    assert.equal(store.projects.get('a')!.current.snapshotRevision, original.current.snapshotRevision)
    assert.deepEqual(store.projects.get('a')!.current.data, bad)
  }
})

test('clearing accommodation is refused until recovery material exists; no partial transaction', async () => {
  const { send, store } = setup()
  await send('guest.add', { id: 'g', name: '宾客', group: '' })
  await send('room.add', { id: 'r', label: '101', type: '标间' })
  await send('stayDate.add', { date: '2027-01-01' }, { config: 0 })
  await send('guest.assignRoom', { id: 'g', roomId: 'r' }, { 'guest:g': 0, 'room:r': 0 })
  await send('guest.setStayDates', { id: 'g', dates: ['2027-01-01'] }, { 'guest:g': 1, config: 1 })
  const before = structuredClone(store.projects.get('a'))
  await assert.rejects(send('guest.assignRoom', { id: 'g', roomId: null }, { 'guest:g': 2 }), { code: 'INVALID_INPUT' })
  assert.deepEqual(store.projects.get('a'), before)
})

test('receipt for reused operation ID cannot acknowledge a different draft', async () => {
  const { service, cmd, read } = setup()
  const original = cmd('guest.add', { id: 'g', name: '原始姓名', group: '' })
  await service.execute(original, 'collab')
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const box = durableOutbox(storage, {
    queryReceipt: c => service.queryReceipt(c.projectId, c.dataEpoch, c.operationId, 'collab'),
    execute: c => service.execute(c, 'collab'),
  })
  const changed = { ...original, payload: { id: 'g', name: '另一份草稿', group: '' } }
  await box.prepare(changed)
  assert.equal((await box.send('a', 'e1', original.operationId)).status, 'failed')
  assert.deepEqual((await storage.get('a', 'e1', original.operationId))?.command, changed)
  assert.equal((await read()).guests.g.name, '原始姓名')
  storage.close()
})

test('explicit entity order survives JSON persistence even for numeric-looking IDs', async () => {
  const { send, read } = setup()
  for (const id of ['10', '2', '1']) {
    await send('guest.add', { id, name: id, group: '' })
    await send('table.add', { id, label: id, seats: 8, x: 0, y: 0 })
    await send('room.add', { id, label: id, type: '标间' })
  }
  const state = JSON.parse(JSON.stringify(await read())) as Core
  for (const order of [state.guestOrder, state.tableOrder, state.roomOrder]) assert.deepEqual(order, ['10', '2', '1'])
})

test('seat swap is atomic, preserves attendance and rejects stale peers without partial writes', async () => {
  const { send, read, store, service, cmd } = setup()
  await send('table.add', { id: 't', label: '桌', seats: 2, x: 0, y: 0 })
  for (const [id, seatIndex] of [['a', 0], ['b', 1]] as const) {
    await send('guest.add', { id, name: id, group: '' })
    await send('guest.assign', { id, tableId: 't', seatIndex }, { [`guest:${id}`]: 0, 'table:t': 0 })
  }
  await send('guest.update', { id: 'a', patch: { attendance: 'confirmed' } }, { 'guest:a': 1 })
  const swap = cmd('guest.swapSeats', { firstId: 'a', secondId: 'b' }, { 'guest:a': 2, 'guest:b': 1, 'table:t': 0 })
  const before = structuredClone(store.projects.get('a'))
  store.failReceipt = true
  await assert.rejects(service.execute(swap, 'collab'))
  assert.deepEqual(store.projects.get('a'), before)
  store.failReceipt = false
  const receipt = await service.execute(swap, 'collab')
  assert.deepEqual(await service.execute(swap, 'collab'), receipt)
  const after = await read()
  assert.equal(after.guests.a.seatIndex, 1); assert.equal(after.guests.b.seatIndex, 0)
  assert.equal(after.guests.a.attendance, 'confirmed')
  await assert.rejects(send('guest.swapSeats', swap.payload, swap.expectedRevisions), { code: 'CONFLICT' })
  assert.deepEqual(await read(), after)
})
