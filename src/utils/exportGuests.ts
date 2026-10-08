import * as XLSX from 'xlsx'
import type { Guest, Table } from '../types/index.ts'

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
  if (guest.attendance) return { pending: '待确认', confirmed: '已确认', declined: '不出席' }[guest.attendance]
  return guest.status === 'confirmed' ? '已确认' : '待确认'
}

/**
 * 导出宾客名单为 Excel，格式与「宾客导入模板」一致：
 * 姓名 | 电话 | 分组标签 | 所属方 | 出席状态 | 桌号/桌名 | 备注
 */
export function buildGuestWorkbook(guests: Guest[], tables: Table[], preserveFields = false) {
  const tableMap = new Map(tables.map((t) => [t.id, t.label]))

  const rows = guests.map((g) => ({
    姓名: g.name,
    电话: g.phone || '',
    分组标签: preserveFields ? g.group : cleanGroup(g.group),
    所属方: preserveFields ? (g.side && g.side !== 'unset' ? { bride: '女方', groom: '男方', shared: '共同' }[g.side] : '') : deriveSide(g),
    出席状态: deriveStatus(g),
    '桌号/桌名': g.tableId ? tableMap.get(g.tableId) || '' : '',
    备注: g.notes || '',
  }))

  const headers = ['姓名', '电话', '分组标签', '所属方', '出席状态', '桌号/桌名', '备注']
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers })

  // 列宽
  ws['!cols'] = [
    { wch: 12 }, // 姓名
    { wch: 16 }, // 电话
    { wch: 14 }, // 分组标签
    { wch: 8 },  // 所属方
    { wch: 10 }, // 出席状态
    { wch: 12 }, // 桌号/桌名
    { wch: 20 }, // 备注
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '宾客名单')

  return wb
}

export function exportGuestsToExcel(guests: Guest[], tables: Table[]) {
  const wb = buildGuestWorkbook(guests, tables)
  const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')
  XLSX.writeFile(wb, `宾客名单_${date}.xlsx`)
}
