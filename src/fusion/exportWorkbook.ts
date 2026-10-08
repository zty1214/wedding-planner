import { roomViews } from './roomNights.ts'
import { buildGuestWorkbook } from '../utils/exportGuests.ts'
import { buildRoomWorkbook } from '../utils/exportRooms.ts'
import type { Guest } from '../types/index.ts'
import type { ExportSnapshot } from './repository.ts'

export function buildExportWorkbook(value: ExportSnapshot, kind: 'guests' | 'rooms') {
  const { snapshot, source, projectId, capturedAt } = value, core = snapshot.data
  const guests: Guest[] = core.guestOrder.map(id => ({ ...core.guests[id], status: core.guests[id].attendance === 'confirmed' ? 'confirmed' : core.guests[id].tableId ? 'assigned' : 'unassigned' }))
  const workbook = kind === 'guests'
    ? buildGuestWorkbook(guests, core.tableOrder.map(id => core.tables[id]), true)
    : buildRoomWorkbook(roomViews(core), guests, core.config.stayDates, true)
  const label = source === 'confirmed' ? '云端已确认' : '本机未同步草稿'
  const provenance = `${label}；项目 ${projectId}；代次 ${snapshot.dataEpoch}；核心版本 ${snapshot.snapshotRevision}；取样 ${capturedAt}${value.restoreTarget ? `；待恢复目标 ${value.restoreTarget.id}（${value.restoreTarget.name}），尚未执行恢复` : ''}`
  workbook.Props = { Title: `${core.config.title} · ${label}`, Subject: provenance, Comments: provenance }
  const title = Array.from(core.config.title, c => c.charCodeAt(0) < 32 ? '_' : c).join('').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '婚礼项目'
  return { workbook, filename: `${title}_${kind === 'guests' ? '宾客名单' : '住宿安排'}_${label}_r${snapshot.snapshotRevision}_${capturedAt.replace(/[:.]/g, '-')}.xlsx` }
}
