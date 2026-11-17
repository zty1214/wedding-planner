import type { Core, CoreGuest } from './core.ts'
import { CommandError } from './protocol.ts'

export function householdMembers(core: Core, id: string) {
  return Object.values(core.guests).filter(guest => guest.household?.id === id)
}

/** Bind a bulk edit to the complete group the caller saw. */
export function checkedHouseholdMembers(core: Core, id: string, revisions: Record<string, number>) {
  const members = householdMembers(core, id)
  if (!members.length || Object.keys(revisions).length !== members.length
    || members.some(guest => revisions[`guest:${guest.id}`] !== guest.revision)) throw new CommandError('CONFLICT')
  return members
}

export function newGuest(id: string, name: string, group: string): CoreGuest {
  return {
    id, name, group, revision: 0, phone: '', notes: '', side: 'unset', attendance: 'pending',
    tableId: null, seatIndex: null, roomId: null, stayNeed: 'pending', stayDates: [],
  }
}

export function adjacentEmptySeats(core: Core, anchor: CoreGuest, count: number): number[] {
  if (anchor.tableId === null || anchor.seatIndex === null || count === 0) return []
  const table = core.tables[anchor.tableId]
  const blocked = new Set(Object.values(core.guests).filter(g => g.tableId === table.id).map(g => g.seatIndex))
  const seats: number[] = []
  let clockwise = true, counterclockwise = true
  for (let distance = 1; distance < table.seats && seats.length < count && (clockwise || counterclockwise); distance++) {
    const right = (anchor.seatIndex + distance) % table.seats
    const left = (anchor.seatIndex - distance + table.seats) % table.seats
    if (clockwise && blocked.has(right)) clockwise = false
    if (counterclockwise && blocked.has(left)) counterclockwise = false
    if (clockwise) { seats.push(right); blocked.add(right) }
    if (counterclockwise && seats.length < count && !blocked.has(left)) { seats.push(left); blocked.add(left) }
  }
  return seats
}
