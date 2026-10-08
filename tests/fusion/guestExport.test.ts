import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildGuestWorkbook } from '../../src/utils/exportGuests.ts'
import type { Guest } from '../../src/types/index.ts'
const guest: Guest = { id: 'a', name: '小明', group: '新郎亲属', phone: '0013800000000', notes: '长备注'.repeat(200),
  tableId: 't', seatIndex: 0, roomId: null, stayDates: [], status: 'assigned' }

test('guest Excel preserves seven columns, text phones, distinct people and explicit attendance/side', () => {
  const workbook = buildGuestWorkbook([
    { ...guest, attendance: 'confirmed', side: 'bride' },
    { ...guest, id: 'b', name: '小明 2', tableId: null, attendance: 'declined', side: 'shared' },
    { ...guest, id: 'c', attendance: 'pending', side: 'unset' },
    { ...guest, id: 'd', group: '新娘同事', status: 'confirmed' },
  ], [{ id: 't', label: '亲友桌', x: 0, y: 0, seats: 8, rotation: 0 }])
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const read = XLSX.read(bytes, { type: 'buffer' }), sheet = read.Sheets['宾客名单']
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
  assert.deepEqual(rows[0], ['姓名', '电话', '分组标签', '所属方', '出席状态', '桌号/桌名', '备注'])
  assert.equal(sheet.B2.t, 's'); assert.equal(rows[1][1], '0013800000000')
  assert.equal(rows[1][3], '女方'); assert.equal(rows[1][4], '已确认'); assert.equal(rows[1][5], '亲友桌')
  assert.equal(rows[1][6], guest.notes)
  assert.equal(rows[2][0], '小明 2'); assert.equal(rows[2][3], '共同'); assert.equal(rows[2][4], '不出席'); assert.equal(rows[2][5], '')
  assert.equal(rows[3][3], '男方'); assert.equal(rows[3][4], '待确认')
  assert.equal(rows[4][3], '女方'); assert.equal(rows[4][4], '已确认')
})


test('Fusion workbook preserves full groups and leaves unset side blank without inference', async () => {
  const { emptyCore } = await import('../../src/fusion/core.ts')
  const { buildExportWorkbook } = await import('../../src/fusion/exportWorkbook.ts')
  const core = emptyCore()
  core.guests.a = { id: 'a', revision: 0, name: '虚构宾客', group: '新娘同事', phone: '000123', notes: '', side: 'unset', attendance: 'pending', tableId: null, seatIndex: null, roomId: null, stayNeed: 'pending', stayDates: [] }
  core.guestOrder = ['a']
  const result = buildExportWorkbook({ projectId: 'p', source: 'confirmed', capturedAt: '2026-10-08T00:00:00.000Z', snapshot: { data: core, dataEpoch: 'e', snapshotRevision: 0, role: 'management' } }, 'guests')
  const bytes = XLSX.write(result.workbook, { type: 'buffer', bookType: 'xlsx' })
  const read = XLSX.read(bytes, { type: 'buffer' }), rows = XLSX.utils.sheet_to_json<string[]>(read.Sheets['宾客名单'], { header: 1 })
  assert.equal(rows[1][1], '000123'); assert.equal(rows[1][2], '新娘同事'); assert.equal(rows[1][3], '')
  core.guests.a.side = 'groom'
  const explicit = buildExportWorkbook({ projectId: 'p', source: 'confirmed', capturedAt: '2026-10-08T00:00:00.000Z', snapshot: { data: core, dataEpoch: 'e', snapshotRevision: 0, role: 'management' } }, 'guests')
  const explicitRows = XLSX.utils.sheet_to_json<string[]>(explicit.workbook.Sheets['宾客名单'], { header: 1 })
  assert.equal(explicitRows[1][2], '新娘同事'); assert.equal(explicitRows[1][3], '男方')
})
