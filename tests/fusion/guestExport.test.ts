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


test('Fusion workbook matches guest controls and round-trips guest ID, text phone and stay need', async () => {
  const { emptyCore } = await import('../../src/fusion/core.ts')
  const { buildExportWorkbook } = await import('../../src/fusion/exportWorkbook.ts')
  const { readGuestRosterWorkbook } = await import('../../src/fusion/guestRosterWorkbook.ts')
  const { applyGuestRoster, planGuestRoster } = await import('../../src/fusion/guestRoster.ts')
  const core = emptyCore()
  core.guests.a = { id: 'a', revision: 0, name: '虚构宾客', group: '新娘同事', phone: '000123', notes: '', side: 'groom', attendance: 'pending', tableId: null, seatIndex: null, roomId: null, stayNeed: 'needed', stayDates: [], household: { id: 'h', name: '虚构户' }, travelMode: 'rail' }
  core.guestOrder = ['a']
  const result = buildExportWorkbook({ projectId: 'p', source: 'confirmed', capturedAt: '2026-10-08T00:00:00.000Z', snapshot: { data: core, dataEpoch: 'e', snapshotRevision: 0, role: 'management' } }, 'guests')
  const bytes: ArrayBuffer = XLSX.write(result.workbook, { type: 'array', bookType: 'xlsx' })
  const read = XLSX.read(bytes, { type: 'array' }), sheet = read.Sheets['宾客名单']
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
  assert.deepEqual(rows[0], ['姓名', '电话', '分组标签', '出席状态', '住宿需求', '桌号/桌名', '备注', '宾客编号', '户名', '出行方式'])
  assert.deepEqual(rows[1], ['虚构宾客', '000123', '新娘同事', '待确认', '需要住宿', '', '', 'a', '虚构户', '高铁'])
  assert.equal(sheet.B2.t, 's')
  assert.deepEqual(planGuestRoster(core, readGuestRosterWorkbook(bytes)), { added: [], updated: [], removed: [] })
  const legacyWorkbook = XLSX.utils.book_new()
  const legacyMember = rows[1].slice(0, 8)
  legacyMember[0] = '同一编号的新称呼'
  XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([rows[0].slice(0, 8), legacyMember]), '宾客名单')
  const legacyPlan = planGuestRoster(core, readGuestRosterWorkbook(XLSX.write(legacyWorkbook, { type: 'array', bookType: 'xlsx' })))
  const retained = applyGuestRoster(core, legacyPlan, () => 'unused').guests.a
  assert.equal(retained.name, '同一编号的新称呼')
  assert.deepEqual(retained.household, core.guests.a.household)
  assert.equal(retained.travelMode, 'rail')

  sheet.B2 = { t: 'n', v: 123 }
  assert.throws(() => readGuestRosterWorkbook(XLSX.write(read, { type: 'array', bookType: 'xlsx' })), /第 2 行「电话」请填写文本/)
  sheet.B2 = { t: 's', v: '000123' }; sheet.A2 = { t: 's', v: '名字', f: '"名字"' }
  assert.throws(() => readGuestRosterWorkbook(XLSX.write(read, { type: 'array', bookType: 'xlsx' })), /第 2 行「姓名」包含公式/)
})
