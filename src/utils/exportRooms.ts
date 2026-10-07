import * as XLSX from 'xlsx'
import type { Guest, Room } from '../types/index.ts'
import { formatNight } from './date.ts'
import { accommodationNight } from './accommodation.ts'

/**
 * 导出住宿安排为 Excel，两个 sheet：
 * 1) 「住宿明细」：行=房间，列=房号/房型/每日期(该晚入住人)/备注 —— 日期矩阵，直观看每晚谁住哪间
 * 2) 「每晚用房」：行=日期，列=大床房/标间/合计/当晚入住人数 —— 直接报给酒店的用房统计
 */
export function buildRoomWorkbook(rooms: Room[], guests: Guest[], stayDates: string[]) {
  const dates = [...stayDates].sort((a, b) => a.localeCompare(b))
  const crossYear = new Set(dates.map(date => date.slice(0, 4))).size > 1
  const dateLabel = (date: string) => crossYear ? date : formatNight(date)
  const typeOrder: Record<string, number> = { 大床房: 0, 标间: 1 }

  const sortedRooms = [...rooms].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 9
    const tb = typeOrder[b.type] ?? 9
    if (ta !== tb) return ta - tb
    return a.label.localeCompare(b.label, 'zh-CN')
  })

  const occupantsOn = (roomId: string, date: string) =>
    guests.filter((g) => g.roomId === roomId && (g.stayDates || []).includes(date))

  // ---------- Sheet1 住宿明细（日期矩阵） ----------
  const detailHeader = ['房间号', '房型', ...dates.map(dateLabel), '备注']
  const detailRows = sortedRooms.map((r) => {
    const row: Record<string, string> = { 房间号: r.label, 房型: r.type }
    dates.forEach((d) => {
      row[dateLabel(d)] = occupantsOn(r.id, d).map((g) => g.name).join('、')
    })
    row['备注'] = r.notes || ''
    return row
  })
  const wsDetail = XLSX.utils.json_to_sheet(detailRows, { header: detailHeader })
  wsDetail['!cols'] = [
    { wch: 12 }, // 房间号
    { wch: 10 }, // 房型
    ...dates.map(() => ({ wch: 18 })), // 日期列
    { wch: 18 }, // 备注
  ]

  // ---------- Sheet2 每晚用房汇总 ----------
  const sumHeader = ['日期', '大床房', '标间', '合计用房', '当晚入住人数']
  const sumRows = dates.map((d) => {
    const { king, twin, people } = accommodationNight(rooms, guests, d)
    return { 日期: dateLabel(d), 大床房: king, 标间: twin, 合计用房: king + twin, 当晚入住人数: people }
  })
  const wsSum = XLSX.utils.json_to_sheet(sumRows, { header: sumHeader })
  wsSum['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsDetail, '住宿明细')
  XLSX.utils.book_append_sheet(wb, wsSum, '每晚用房')

  return wb
}

export function exportRoomsToExcel(rooms: Room[], guests: Guest[], stayDates: string[]) {
  const wb = buildRoomWorkbook(rooms, guests, stayDates)
  const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')
  XLSX.writeFile(wb, `住宿安排_${date}.xlsx`)
}
