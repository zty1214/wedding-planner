import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { accommodationNight, accommodationTodos, roomOccupancy } from '../../src/utils/accommodation.ts'
import { buildRoomWorkbook } from '../../src/utils/exportRooms.ts'
import type { Guest, Room } from '../../src/types/index.ts'
const dates = ['2027-01-01', '2027-01-02']
const room: Room = { id: 'r', type: '标间', label: '101' }
function guest(id: string, stayDates: string[], patch: Partial<Guest> = {}): Guest {
  return { id, name: id, group: '', status: 'unassigned', tableId: null, seatIndex: null, roomId: 'r', stayNeed: 'needed', stayDates, ...patch }
}
test('room warnings use per-night occupancy, not total assigned people; undated guests stay visible', () => {
  const people = [guest('小明', [dates[0]]), guest('小明 2', [dates[1]]), guest('朋友', dates), guest('晚次待定', [])]
  const occupancy = roomOccupancy(room, people, dates)
  assert.equal(occupancy.assigned.length, 4); assert.equal(occupancy.peak, 2)
  assert.deepEqual(occupancy.over, []); assert.equal(occupancy.undated.length, 1)
  const over = roomOccupancy(room, [...people, guest('同晚第三人', [dates[1]])], dates)
  assert.deepEqual(over.over, [{ date: dates[1], people: 3 }])
  assert.deepEqual(roomOccupancy(room, people, []).nights, [])
})
test('lodging todos separate need, room and dates independently from attendance', () => {
  const people = [guest('需分房', [], { roomId: null, attendance: 'declined' }),
    guest('待确认', [], { roomId: null, stayNeed: 'pending', status: 'confirmed' }),
    guest('不需要', [], { roomId: null, stayNeed: 'not_needed', status: 'confirmed' }),
    guest('需选晚次', []), guest('完整', dates)]
  const todo = accommodationTodos(people)
  assert.deepEqual(todo.needsRoom.map(g => g.id), ['需分房'])
  assert.deepEqual(todo.needsDecision.map(g => g.id), ['待确认'])
  assert.deepEqual(todo.needsDates.map(g => g.id), ['需选晚次'])
})
test('night statistics and exported matrices agree for staggered arrivals and partial nights', () => {
  const people = [guest('小明', dates), guest('小明 2', [dates[1]]), guest('待定', []), guest('无房', dates, { roomId: null })]
  assert.deepEqual(accommodationNight([room], people, dates[0]), { king: 0, twin: 1, total: 1, people: 1, checkIn: 1 })
  assert.deepEqual(accommodationNight([room], people, dates[1]), { king: 0, twin: 1, total: 1, people: 2, checkIn: 1 })
  const bytes = XLSX.write(buildRoomWorkbook([room], people, dates), { type: 'buffer', bookType: 'xlsx' })
  const wb = XLSX.read(bytes, { type: 'buffer' })
  assert.deepEqual(wb.SheetNames, ['住宿明细', '每晚用房'])
  const detail = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['住宿明细'], { header: 1 })
  assert.deepEqual(detail[0], ['房间号', '房型', '1.1', '1.2', '备注'])
  assert.equal(detail[1][2], '小明'); assert.equal(detail[1][3], '小明、小明 2')
  const summary = XLSX.utils.sheet_to_json(wb.Sheets['每晚用房'])
  assert.deepEqual(summary, [
    { 日期: '1.1', 大床房: 0, 标间: 1, 合计用房: 1, 当晚入住人数: 1 },
    { 日期: '1.2', 大床房: 0, 标间: 1, 合计用房: 1, 当晚入住人数: 2 },
  ])
})

test('cross-year room exports keep identically numbered days in separate columns', () => {
  const nights = ['2026-01-01', '2027-01-01']
  const bytes = XLSX.write(buildRoomWorkbook([room], [guest('去年', [nights[0]]), guest('今年', [nights[1]])], nights), { type: 'buffer', bookType: 'xlsx' })
  const wb = XLSX.read(bytes, { type: 'buffer' })
  const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['住宿明细'], { header: 1 })
  assert.deepEqual(matrix[0], ['房间号', '房型', ...nights, '备注'])
  assert.equal(matrix[1][2], '去年'); assert.equal(matrix[1][3], '今年')
  assert.deepEqual(XLSX.utils.sheet_to_json<{ 日期: string }>(wb.Sheets['每晚用房']).map(row => row.日期), nights)
})
