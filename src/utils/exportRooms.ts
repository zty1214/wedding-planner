import * as XLSX from 'xlsx'
import type { Guest, Room } from '../types/index.ts'
import { formatNight } from './date.ts'
import { guestStays, stayInRoom } from '../fusion/guestStays.ts'
import { accommodationBilling } from './accommodation.ts'

/**
 * 导出住宿安排为 Excel，两个 sheet：
 * 1) 「住宿明细」：行=房间，列=房号/房型/每日期(该晚入住人)/备注 —— 日期矩阵，直观看每晚谁住哪间
 * 2) 「每晚用房」：行=日期，列=大床房/标间/合计/当晚入住人数 —— 直接报给酒店的用房统计
 */
export function buildRoomWorkbook(rooms: Room[], guests: Guest[], stayDates: string[], includePending = false, twinGiftDate?: string | null) {
  const dates = [...stayDates].sort((a, b) => a.localeCompare(b))
  const crossYear = new Set(dates.map(date => date.slice(0, 4))).size > 1
  const dateLabel = (date: string) => crossYear ? date : formatNight(date)
  const typeOrder: Record<string, number> = { 大床房: 0, 标间: 1, 套房: 2 }

  const sortedRooms = [...rooms].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 9
    const tb = typeOrder[b.type] ?? 9
    if (ta !== tb) return ta - tb
    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true })
  })

  const occupantsOn = (roomId: string, date: string) =>
    guests.filter((g) => stayInRoom(g, roomId)?.dates.includes(date))

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
  const peopleLabel = rooms.some(room => room.stayDates !== undefined) ? '当晚安排人数' : '当晚入住人数'
  const suites = includePending || rooms.some(room => room.type === '套房')
  const billing = accommodationBilling(rooms, guests, dates, twinGiftDate)
  const scheduledGift = typeof twinGiftDate === 'string'
  const sumHeader = ['日期', '大床房', '标间', ...(suites ? ['套房'] : []), '合计用房', peopleLabel, ...(scheduledGift ? ['赠送间夜', '计费间夜'] : [])]
  const sumRows = billing.nights.map(({ date, king, twin, suite, people, total }) => {
    const gifted = scheduledGift && date === twinGiftDate ? billing.gifted : 0
    return { 日期: dateLabel(date), 大床房: king, 标间: twin, ...(suites ? { 套房: suite } : {}), 合计用房: total, [peopleLabel]: people,
      ...(scheduledGift ? { 赠送间夜: gifted, 计费间夜: total - gifted } : {}) }
  })
  const wsSum = XLSX.utils.json_to_sheet(sumRows, { header: sumHeader })
  wsSum['!cols'] = sumHeader.map((_, index) => ({ wch: index === 0 ? 14 : 12 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsDetail, '住宿明细')
  XLSX.utils.book_append_sheet(wb, wsSum, '每晚用房')
  if (twinGiftDate !== undefined) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['实订间夜', '标间间夜', '赠送标间间夜', '计费间夜', '赠送日期'],
      [billing.actual, billing.twin, billing.gifted, billing.billed, twinGiftDate ?? '待定'],
    ])
    sheet['!cols'] = Array.from({ length: 5 }, () => ({ wch: 16 }))
    XLSX.utils.book_append_sheet(wb, sheet, '间夜计费')
  }
  const roomNames = new Map(rooms.map(room => [room.id, room.label]))
  const pending = guests.flatMap(guest => {
    const stays = guestStays(guest).filter(stay => roomNames.has(stay.roomId))
    if (!stays.length && guest.stayNeed === 'needed') return [{ 姓名: guest.name, 房间号: '', 待确认事项: '需要住宿·未分房' }]
    return stays.filter(stay => !stay.dates.length).map(stay => ({ 姓名: guest.name, 房间号: roomNames.get(stay.roomId)!, 待确认事项: '已分房·晚次待定' }))
  })
  if (includePending && pending.length) {
    const sheet = XLSX.utils.json_to_sheet(pending, { header: ['姓名', '房间号', '待确认事项'] })
    sheet['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(wb, sheet, '待确认住宿')
  }

  return wb
}

export function exportRoomsToExcel(rooms: Room[], guests: Guest[], stayDates: string[]) {
  const wb = buildRoomWorkbook(rooms, guests, stayDates)
  const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')
  XLSX.writeFile(wb, `住宿安排_${date}.xlsx`)
}
