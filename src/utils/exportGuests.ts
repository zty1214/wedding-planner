import * as XLSX from 'xlsx'
import { TRAVEL_LABELS } from '../types/index.ts'
import type { Guest, Table } from '../types/index.ts'
import { ATTENDANCE_LABELS, GUEST_EXPORT_COLUMNS, GUEST_SHEET, STAY_NEED_LABELS } from '../fusion/guestRoster.ts'

// 根据分组推断所属方（男方/女方）
function deriveSide(guest: Guest): string {
  if (guest.side && guest.side !== 'unset') return { bride: '女方', groom: '男方', shared: '共同' }[guest.side]
  const group = guest.group
  if (group.includes('新郎')) return '男方'
  if (group.includes('新娘')) return '女方'
  return ''
}

// 去掉分组标签里的「新郎/新娘」前缀（所属方已区分男女方）
function cleanGroup(group: string): string {
  return group.replace(/^新郎|^新娘/, '')
}

// 出席状态映射
function deriveStatus(guest: Guest): string {
  if (guest.attendance) return ATTENDANCE_LABELS[guest.attendance]
  return guest.status === 'confirmed' ? '已确认' : '待确认'
}

/** The Fusion export doubles as the import template. Existing legacy downloads keep their format. */
export function buildGuestWorkbook(guests: Guest[], tables: Table[], fusion = false) {
  const tableMap = new Map(tables.map(t => [t.id, t.label]))
  const tableName = (g: Guest) => g.tableId ? tableMap.get(g.tableId) ?? '' : ''
  const rows = guests.map(g => fusion ? [g.name, g.phone || '', g.group, deriveStatus(g), STAY_NEED_LABELS[g.stayNeed ?? 'pending'], tableName(g), g.notes || '', g.id, g.household?.name ?? '', TRAVEL_LABELS[g.travelMode ?? 'pending']]
    : [g.name, g.phone || '', cleanGroup(g.group), deriveSide(g), deriveStatus(g), tableName(g), g.notes || ''])
  const headers = fusion ? [...GUEST_EXPORT_COLUMNS] : ['姓名', '电话', '分组标签', '所属方', '出席状态', '桌号/桌名', '备注']
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = (fusion ? [14, 18, 16, 10, 14, 14, 22, 34, 18, 12] : [12, 16, 14, 8, 10, 12, 20]).map(wch => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, GUEST_SHEET)
  return wb
}

export function exportGuestsToExcel(guests: Guest[], tables: Table[]) {
  const wb = buildGuestWorkbook(guests, tables)
  const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')
  XLSX.writeFile(wb, `宾客名单_${date}.xlsx`)
}
