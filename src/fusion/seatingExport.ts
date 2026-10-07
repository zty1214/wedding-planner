import type { ExportSnapshot } from './repository.ts'
import type { Guest } from '../types/index.ts'
import { TABLE_PRESETS } from '../types/index.ts'

/** Geometry and labels are derived once from the same frozen export snapshot. */
export function seatingExportModel(value: ExportSnapshot) {
  const core = structuredClone(value.snapshot.data)
  const tables = core.tableOrder.map(id => core.tables[id])
  const guests: Guest[] = core.guestOrder.map(id => ({ ...core.guests[id], status: core.guests[id].attendance === 'confirmed' ? 'confirmed' : core.guests[id].tableId ? 'assigned' : 'unassigned' }))
  const width = 1200, height = 800
  const mainStagePos = core.config.mainStagePos ?? { x: width / 2, y: 40 }
  let minX = mainStagePos.x - 140, maxX = mainStagePos.x + 140, minY = mainStagePos.y, maxY = mainStagePos.y + 60
  for (const table of tables) {
    const radius = (TABLE_PRESETS.find(p => p.seats === table.seats)?.radius ?? 60) + 60
    minX = Math.min(minX, table.x - radius); maxX = Math.max(maxX, table.x + radius)
    minY = Math.min(minY, table.y - radius); maxY = Math.max(maxY, table.y + radius)
  }
  const scale = Math.min(width / (maxX - minX + 160), height / (maxY - minY + 160), 1.5)
  const label = value.source === 'confirmed' ? '云端已确认' : value.restoreTarget ? '待恢复草稿' : '本机未同步草稿'
  const title = Array.from(core.config.title, c => c.charCodeAt(0) < 32 ? '_' : c).join('').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '婚礼项目'
  return {
    data: { tables, guests, mainStagePos }, title: core.config.title,
    viewport: { width, height, scale, x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 - (minY + maxY) / 2 * scale },
    stats: { tables: tables.length, seats: tables.reduce((sum, table) => sum + table.seats, 0), seated: guests.filter(g => g.tableId).length, confirmed: guests.filter(g => g.attendance === 'confirmed').length },
    provenance: `${label} · r${value.snapshot.snapshotRevision}`,
    capturedAt: value.capturedAt,
    filename: `${title}_座位图_${label}_r${value.snapshot.snapshotRevision}_${value.capturedAt.replace(/[:.]/g, '-')}.png`,
  }
}
