import type { Core } from './core.ts'
/** Room nights are a read-only union of individual guest dates; old room metadata never overrides them. */
export function roomNights(core: Core, roomId: string): string[] {
  const room = core.rooms[roomId]
  if (!room) return []
  return [...new Set(Object.values(core.guests).filter(g => g.roomId === roomId).flatMap(g => g.stayDates))].sort()
}
export function roomViews(core: Core) {
  return core.roomOrder.map(id => ({ ...core.rooms[id], stayDates: roomNights(core, id) }))
}
