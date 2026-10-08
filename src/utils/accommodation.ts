import { ROOM_CAPACITY } from '../types/index.ts'
import type { Guest, Room } from '../types/index.ts'

export function roomOccupancy(room: Room, guests: Guest[], dates: string[]) {
  const assigned = guests.filter(g => g.roomId === room.id)
  const nights = [...new Set(dates)].sort().map(date => ({ date, people: assigned.filter(g => room.stayDates ? room.stayDates.includes(date) : g.stayDates.includes(date)).length }))
  return {
    assigned, nights,
    peak: Math.max(0, ...nights.map(n => n.people)),
    over: nights.filter(n => n.people > ROOM_CAPACITY[room.type]),
    undated: assigned.filter(g => room.stayDates ? room.stayDates.length === 0 : g.stayDates.length === 0),
  }
}

export function accommodationTodos(guests: Guest[]) {
  return {
    needsRoom: guests.filter(g => !g.roomId && (g.stayNeed === undefined ? g.status === 'confirmed' : g.stayNeed === 'needed')),
    needsDecision: guests.filter(g => g.stayNeed === 'pending'),
    needsDates: guests.filter(g => g.roomId && g.stayDates.length === 0),
  }
}

export function accommodationNight(rooms: Room[], guests: Guest[], date: string) {
  const roomIds = new Set(rooms.map(r => r.id))
  const byId = new Map(rooms.map(room => [room.id, room]))
  const occupants = guests.filter(g => g.roomId && roomIds.has(g.roomId) && (byId.get(g.roomId)!.stayDates ?? g.stayDates).includes(date))
  const used = new Set(occupants.map(g => g.roomId))
  const king = rooms.filter(r => r.type === '大床房' && used.has(r.id)).length
  const twin = rooms.filter(r => r.type === '标间' && used.has(r.id)).length
  return { king, twin, total: king + twin, people: occupants.length,
    checkIn: occupants.filter(g => [...(byId.get(g.roomId!)!.stayDates ?? g.stayDates)].sort()[0] === date).length }
}
