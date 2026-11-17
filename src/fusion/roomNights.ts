import type { Core } from './core.ts'
import { stayInRoom } from './guestStays.ts'
/** Room nights are a read-only union of individual guest dates; old room metadata never overrides them. */
export function roomNights(core: Core, roomId: string): string[] {
  const room = core.rooms[roomId]
  if (!room) return []
  return [...new Set(Object.values(core.guests).flatMap(g => stayInRoom(g, roomId)?.dates ?? []))].sort()
}
export function roomViews(core: Core) {
  return core.roomOrder.map(id => ({ ...core.rooms[id], stayDates: roomNights(core, id) }))
}
