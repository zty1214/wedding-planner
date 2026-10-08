import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyCore } from '../../src/fusion/core.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import type { Core } from '../../src/fusion/core.ts'
import type { Command } from '../../src/fusion/protocol.ts'
import { projectDraft } from '../../src/fusion/projectDraft.ts'
import { removeCore } from '../../src/fusion/removeCore.ts'
import { restoreCore } from '../../src/fusion/recycle.ts'
const handlers = coreHandlers()
const command = (type: string, payload: Command['payload'], expectedRevisions: Record<string, number> = {}): Command => ({ projectId: 'p', dataEpoch: 'e', commandVersion: 1, operationId: 'op', type, payload, expectedRevisions })
function apply(core: Core, cmd: Command) { return handlers.get(cmd.type)!.apply(core, cmd) as Core }
function fixture() {
  let c = emptyCore(); c.config.stayDates = ['2027-01-01', '2027-01-02']
  c = apply(c, command('room.add', { id: 'r1', label: '01', type: '大床房' }))
  c = apply(c, command('room.add', { id: 'r2', label: '02', type: '标间' }))
  for (const id of ['a', 'b']) c = apply(c, command('guest.add', { id, name: id, group: '' }))
  return c
}
test('batch arrangements include pending guests, unify room nights, and leave attendance unchanged', () => {
  const c = fixture(), cmd = command('room.arrange', { id: 'r1', guestIds: ['a', 'b'], dates: c.config.stayDates }, { 'room:r1': 0, config: 0, 'guest:a': 0, 'guest:b': 0 })
  const next = apply(c, cmd)
  assert.deepEqual(next.rooms.r1.stayDates, c.config.stayDates)
  for (const g of Object.values(next.guests)) { assert.equal(g.roomId, 'r1'); assert.equal(g.stayNeed, 'needed'); assert.equal(g.attendance, 'pending'); assert.deepEqual(g.stayDates, next.rooms.r1.stayDates) }
  assert.equal(c.guests.a.roomId, null)
  const projected = projectDraft({ data: c, dataEpoch: 'e', snapshotRevision: 0, role: 'management' }, cmd)
  assert.deepEqual(projected.snapshot.data, next)
})
test('stale member, extra occupant, deleted date or duplicate member rejects the whole batch', () => {
  const c = fixture(), cmd = command('room.arrange', { id: 'r1', guestIds: ['a', 'b'], dates: ['2027-01-01'] }, { 'room:r1': 0, config: 0, 'guest:a': 0, 'guest:b': 0 })
  c.guests.b.revision++
  assert.throws(() => apply(c, cmd), /CONFLICT/); assert.equal(c.guests.a.roomId, null); assert.equal(c.rooms.r1.stayDates, undefined)
  c.guests.b.revision = 0
  assert.throws(() => apply(c, { ...cmd, payload: { id: 'r1', guestIds: ['a', 'a'], dates: [] } }), /INVALID_INPUT/)
  assert.throws(() => apply(c, { ...cmd, payload: { id: 'r1', guestIds: ['a', 'b'], dates: ['2027-01-03'] } }), /INVALID_INPUT/)
  const occupied = apply(c, command('guest.assignRoom', { id: 'b', roomId: 'r1' }, { 'guest:b': 0, 'room:r1': 0 }))
  assert.throws(() => apply(occupied, command('room.arrange', { id: 'r1', guestIds: ['a'], dates: [] }, { 'guest:a': 0, 'room:r1': 0, config: 0 })), /CONFLICT/)
})
test('room numbers are unique for create, rename and restoration without rejecting legacy reads', () => {
  const c = fixture()
  assert.throws(() => apply(c, command('room.add', { id: 'r3', label: ' 01 ', type: '标间' })), /CONFLICT/)
  assert.throws(() => apply(c, command('room.update', { id: 'r2', patch: { label: '01' } }, { 'room:r2': 0 })), /CONFLICT/)
  const removed = structuredClone(c), changes = removeCore(removed, command('room.deleteWithAssignments', { id: 'r1' }, { 'room:r1': 0 }))
  const replacement = apply(removed, command('room.add', { id: 'r3', label: '01', type: '标间' }))
  assert.throws(() => restoreCore(replacement, changes, { expectedRevisions: {} }), /CONFLICT/)
})
test('removing a project night preserves atomic recovery of room nights and mirrored guest dates', () => {
  const c = apply(fixture(), command('room.arrange', { id: 'r1', guestIds: ['a'], dates: ['2027-01-01'] }, { 'room:r1': 0, 'guest:a': 0, config: 0 }))
  const before = structuredClone(c)
  const changes = removeCore(c, command('stayDate.remove', { date: '2027-01-01' }, { config: 0, 'guest:a': 1, 'room:r1': 1 }))
  assert.deepEqual(c.rooms.r1.stayDates, []); assert.deepEqual(c.guests.a.stayDates, [])
  restoreCore(c, changes, { expectedRevisions: { config: 1, 'guest:a': 2, 'room:r1': 2 } })
  assert.deepEqual(c.rooms.r1.stayDates, before.rooms.r1.stayDates); assert.deepEqual(c.guests.a.stayDates, before.guests.a.stayDates)
})


test('room-authoritative counts and export preserve different room numbers by night, exclude empty rooms and retain pending rows', async () => {
  const { roomViews } = await import('../../src/fusion/roomNights.ts')
  const { accommodationNight } = await import('../../src/utils/accommodation.ts')
  const { buildRoomWorkbook } = await import('../../src/utils/exportRooms.ts')
  const XLSX = await import('xlsx')
  let c = fixture()
  c = apply(c, command('room.arrange', { id: 'r1', guestIds: ['a'], dates: ['2027-01-01'] }, { 'room:r1': 0, 'guest:a': 0, config: 0 }))
  c = apply(c, command('room.arrange', { id: 'r2', guestIds: ['b'], dates: ['2027-01-02'] }, { 'room:r2': 0, 'guest:b': 0, config: 0 }))
  c = apply(c, command('room.add', { id: 'empty', label: '03', type: '大床房' }))
  c = apply(c, command('room.arrange', { id: 'empty', guestIds: [], dates: c.config.stayDates }, { 'room:empty': 0, config: 0 }))
  const guests = Object.values(c.guests).map(g => ({ ...g, status: 'unassigned' as const }))
  const rooms = roomViews(c)
  for (const date of c.config.stayDates) assert.equal(accommodationNight(rooms, guests, date).total, 1)
  const wb = buildRoomWorkbook(rooms, guests, c.config.stayDates, true)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['每晚用房'])
  assert.deepEqual(rows.map(row => row['合计用房']), [1, 1])
  assert.ok(rows.every(row => row['当晚安排人数'] === 1))
  const emptied = structuredClone(c)
  removeCore(emptied, command('guest.clearRoom', { id: 'a' }, { 'guest:a': 1 }))
  const remainingGuests = Object.values(emptied.guests).map(g => ({ ...g, status: 'unassigned' as const }))
  assert.deepEqual(emptied.rooms.r1.stayDates, ['2027-01-01']) // Retain metadata without reporting an empty room.
  assert.equal(accommodationNight(roomViews(emptied), remainingGuests, '2027-01-01').total, 0)
  const emptiedWorkbook = buildRoomWorkbook(roomViews(emptied), remainingGuests, emptied.config.stayDates, true)
  assert.deepEqual(XLSX.utils.sheet_to_json<Record<string, unknown>>(emptiedWorkbook.Sheets['每晚用房']).map(row => row['合计用房']), [0, 1])
  const pending = apply(c, command('room.arrange', { id: 'r1', guestIds: [], dates: [] }, { 'room:r1': 1, 'guest:a': 1, config: 0 }))
  const pendingGuests = Object.values(pending.guests).map(g => ({ ...g, status: 'unassigned' as const }))
  const result = buildRoomWorkbook(roomViews(pending), pendingGuests, [], true)
  assert.equal(XLSX.utils.sheet_to_json(result.Sheets['待确认住宿']).length, 1)
})
