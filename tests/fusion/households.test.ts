import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { recycleService } from '../../server/fusion/recycleService.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Core } from '../../src/fusion/core.ts'
import { newGuest } from '../../src/fusion/households.ts'
import { guestStays } from '../../src/fusion/guestStays.ts'
import { accommodationBilling } from '../../src/utils/accommodation.ts'
import type { Guest } from '../../src/types/index.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
import { MemoryStore } from './memoryStore.ts'

function setup(core: Core) {
  const store = new MemoryStore()
  store.seed('project', { collaborationHash: hashSecret('collab'), managementHash: hashSecret('manager') },
    { dataEpoch: 'first', snapshotRevision: 12, data: core })
  const service = commandService(store, coreHandlers())
  const command = (type: string, payload: Json, expectedRevisions: Record<string, number> = {}): Command => ({
    projectId: 'project', dataEpoch: 'first', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions,
  })
  const read = async () => (await service.read('project', 'collab'))!.data as Core
  return { store, service, command, read }
}

test('approved household correction is one version-bound write, keeps arrangements and only fills adjacent gaps', async () => {
  const core = emptyCore()
  core.config.stayDates = ['2027-01-02']
  core.tables.t = { id: 't', revision: 0, label: '桌1', seats: 8, x: 0, y: 0, rotation: 0 }
  core.tableOrder = ['t']
  core.rooms.r = { id: 'r', revision: 0, label: '标间1', type: '标间', notes: '' }
  core.roomOrder = ['r']
  const anchor = { ...newGuest('g', '甲4', '亲友'), side: 'shared' as const, attendance: 'confirmed' as const,
    roomId: 'r', stayNeed: 'needed' as const, stayDates: core.config.stayDates, phone: '000123', tableId: 't', seatIndex: 0, revision: 2 }
  core.guests = { g: anchor, b: { ...newGuest('b', '乙1', '亲友'), tableId: 't', seatIndex: 2 },
    c: { ...newGuest('c', '乙2', '亲友'), tableId: 't', seatIndex: 6 } }
  core.guestOrder = ['g', 'b', 'c']
  const { service, store, read, command } = setup(core)
  const reconcile = command('household.reconcile', { households: [
    { id: 'h1', name: '甲', memberIds: ['g'], additions: ['a1', 'a2', 'a3'].map((id, i) => ({ id, name: '甲' + (i + 1) })) },
    { id: 'h2', name: '乙', memberIds: ['b', 'c'], additions: [] },
  ] }, { snapshot: 12, 'guest:g': 2, 'guest:b': 0, 'guest:c': 0 })
  await assert.rejects(service.execute(reconcile, 'collab'), { code: 'FORBIDDEN' })
  await assert.rejects(service.execute({ ...reconcile, expectedRevisions: { ...reconcile.expectedRevisions, snapshot: 11 } }, 'manager'), { code: 'CONFLICT' })
  store.failReceipt = true
  await assert.rejects(service.execute(reconcile, 'manager'))
  assert.deepEqual(await read(), core)
  store.failReceipt = false
  const receipt = await service.execute(reconcile, 'manager')
  assert.deepEqual(await service.execute(reconcile, 'manager'), receipt)
  const result = await read()
  assert.deepEqual(result.guests.g, { ...anchor, household: { id: 'h1', name: '甲' }, revision: 3 })
  assert.deepEqual(result.guests.b, { ...core.guests.b, household: { id: 'h2', name: '乙' }, revision: 1 })
  assert.deepEqual(result.guests.c, { ...core.guests.c, household: { id: 'h2', name: '乙' }, revision: 1 })
  assert.deepEqual(['a1', 'a2', 'a3'].map(id => [result.guests[id].tableId, result.guests[id].seatIndex]), [['t', 1], ['t', 7], [null, null]])
  for (const id of ['a1', 'a2', 'a3']) {
    const g = result.guests[id]
    assert.equal(g.group, anchor.group); assert.equal(g.side, anchor.side)
    assert.equal(g.phone, ''); assert.equal(g.attendance, 'pending'); assert.equal(g.stayNeed, 'pending')
    assert.deepEqual(guestStays(g), [])
  }
})

test('a new household creates independent people, and shared travel can have an individual override', async () => {
  const { service, read, command } = setup(emptyCore())
  await service.execute(command('household.create', { id: 'h', name: '家庭', group: '亲友', guestIds: ['g1', 'g2'] }), 'collab')
  const created = await read()
  assert.deepEqual(created.guestOrder, ['g1', 'g2'])
  assert.deepEqual(Object.values(created.guests).map(g => [g.name, g.household?.id, g.tableId]), [['家庭1', 'h', null], ['家庭2', 'h', null]])
  await service.execute(command('household.setTravel', { id: 'h', travelMode: 'charter' }, { 'guest:g1': 0, 'guest:g2': 0 }), 'collab')
  await service.execute(command('guest.update', { id: 'g2', patch: { travelMode: 'rail' } }, { 'guest:g2': 1 }), 'collab')
  await assert.rejects(service.execute(command('household.setTravel', { id: 'h', travelMode: 'driving' }, { 'guest:g1': 1, 'guest:g2': 1 }), 'collab'), { code: 'CONFLICT' })
  assert.deepEqual(Object.values((await read()).guests).map(g => g.travelMode), ['charter', 'rail'])
})

test('room changes by night preserve existing stays and the gift offsets one scheduled twin night at most', async () => {
  const core = emptyCore(), early = '2026-12-31', first = '2027-01-01', second = '2027-01-02'
  core.config.stayDates = [early, first, second]
  core.guests = { a: newGuest('a', '甲', ''), b: newGuest('b', '乙', ''), c: newGuest('c', '丙', '') }
  core.guestOrder = ['a', 'b', 'c']
  core.rooms = { s: { id: 's', label: '套房1', type: '套房', revision: 0, notes: '', reservedGuestIds: ['a', 'b'] },
    t: { id: 't', label: '标间1', type: '标间', revision: 0, notes: '' } }
  core.roomOrder = ['s', 't']
  const { service, store, read, command } = setup(core)
  const assign = (id: string, guestIds: string[], dates: string[], expected: Record<string, number>) =>
    service.execute(command('room.assignGuests', { id, guestIds, dates, byNight: true }, { config: 0, [`room:${id}`]: 0, ...expected }), 'collab')
  await assign('s', ['a', 'b'], [first, second], { 'guest:a': 0, 'guest:b': 0 })
  await assign('t', ['a', 'b'], [early], { 'guest:a': 1, 'guest:b': 1 })
  await assert.rejects(assign('t', ['a'], [first], { 'guest:a': 2 }), { code: 'CONFLICT' })
  await assert.rejects(assign('s', ['c'], [early], { 'guest:c': 0 }), { code: 'CONFLICT' })
  const saved = await read()
  assert.deepEqual(guestStays(saved.guests.a), [{ roomId: 's', dates: [first, second] }, { roomId: 't', dates: [early] }])
  const bills = (date: string | null) => {
    const guests: Guest[] = Object.values(saved.guests).map(g => ({ ...g, status: 'unassigned' }))
    return accommodationBilling(Object.values(saved.rooms), guests, core.config.stayDates, date)
  }
  assert.deepEqual(bills(null).nights.map(n => [n.twin, n.suite, n.people]), [[1, 0, 2], [0, 1, 2], [0, 1, 2]])
  assert.deepEqual([bills(null).actual, bills(null).billed, bills(first).gifted, bills(early).gifted], [3, 2, 0, 1])
  const clear = command('guest.clearRoom', { id: 'a', roomId: 's' }, { 'guest:a': 2 })
  await recycleService(store).execute(clear, 'collab')
  assert.deepEqual(guestStays((await read()).guests.a), [{ roomId: 't', dates: [early] }])
  await recycleService(store).execute(command('recycle.restore', { id: clear.operationId }, { 'guest:a': 3 }), 'collab')
  assert.deepEqual(guestStays((await read()).guests.a), guestStays(saved.guests.a))
})
