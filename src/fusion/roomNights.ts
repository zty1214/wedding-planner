import type { Core } from './core.ts'
/** Legacy reads derive a room-wide union without modifying original guest facts. */
export function roomNights(core: Core, roomId: string): string[] {
  const room = core.rooms[roomId]
  if (!room) return []
  return room.stayDates ?? [...new Set(Object.values(core.guests).filter(g => g.roomId === roomId).flatMap(g => g.stayDates))].sort()
}
export function roomViews(core: Core) {
  return core.roomOrder.map(id => ({ ...core.rooms[id], stayDates: roomNights(core, id) }))
}
