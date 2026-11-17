import { guestStays, stayInRoom } from '../fusion/guestStays.ts'
import { ROOM_CAPACITY } from '../types/index.ts'
import type { Guest, Room } from '../types/index.ts'

export function roomOccupancy(room: Room, guests: Guest[], dates: string[]) {
  const assigned = guests.filter(g => stayInRoom(g, room.id))
  const nights = [...new Set(dates)].sort().map(date => ({ date, people: assigned.filter(g => stayInRoom(g, room.id)?.dates.includes(date)).length }))
  return {
    assigned, nights,
    peak: Math.max(0, ...nights.map(n => n.people)),
    over: nights.filter(n => n.people > ROOM_CAPACITY[room.type]),
    undated: assigned.filter(g => !stayInRoom(g, room.id)?.dates.length),
  }
}

export function accommodationTodos(guests: Guest[]) {
  return {
    needsRoom: guests.filter(g => !g.roomId && (g.stayNeed === undefined ? g.status === 'confirmed' : g.stayNeed === 'needed')),
    needsDecision: guests.filter(g => g.stayNeed === 'pending'),
    needsDates: guests.filter(g => guestStays(g).some(stay => !stay.dates.length)),
  }
}

export function accommodationNight(rooms: Room[], guests: Guest[], date: string) {
  const roomIds = new Set(rooms.map(r => r.id))
  const used = new Set<string>()
  let people = 0, checkIn = 0
  for (const guest of guests) {
    const stays = guestStays(guest).filter(stay => roomIds.has(stay.roomId))
    const night = stays.find(stay => stay.dates.includes(date))
    if (!night) continue
    used.add(night.roomId)
    people++
    if (!stays.some(stay => stay.dates.some(day => day < date))) checkIn++
  }
  const king = rooms.filter(r => r.type === '大床房' && used.has(r.id)).length
  const twin = rooms.filter(r => r.type === '标间' && used.has(r.id)).length
  const suite = rooms.filter(r => r.type === '套房' && used.has(r.id)).length
  return { king, twin, suite, total: king + twin + suite, people, checkIn }
}

export function accommodationBilling(rooms: Room[], guests: Guest[], dates: string[], giftDate?: string | null) {
  const nights = [...new Set(dates)].sort().map(date => ({ date, ...accommodationNight(rooms, guests, date) }))
  const actual = nights.reduce((total, row) => total + row.total, 0)
  const twin = nights.reduce((total, row) => total + row.twin, 0)
  const gifted = Number(giftDate !== undefined && nights.some(row => row.twin > 0 && (giftDate === null || row.date === giftDate)))
  return { nights, actual, twin, gifted, billed: actual - gifted }
}
