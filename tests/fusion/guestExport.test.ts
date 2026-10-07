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
