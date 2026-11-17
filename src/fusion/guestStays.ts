import type { Guest, RoomStay } from '../types/index.ts'

type GuestStays = Pick<Guest, 'roomId' | 'stayDates' | 'additionalRoomStays'>

/** The original room and dates remain readable in saved versions and old drafts. */
export function guestStays(guest: GuestStays): RoomStay[] {
  if (!guest.roomId) return []
  return [{ roomId: guest.roomId, dates: guest.stayDates }, ...(guest.additionalRoomStays ?? [])]
}

export function stayInRoom(guest: GuestStays, roomId: string): RoomStay | undefined {
  return guestStays(guest).find(stay => stay.roomId === roomId)
}

export function writeGuestStays(guest: GuestStays, stays: RoomStay[]) {
  const [first, ...rest] = stays
  guest.roomId = first?.roomId ?? null
  guest.stayDates = first?.dates ?? []
  if (rest.length) guest.additionalRoomStays = rest
  else delete guest.additionalRoomStays
}

export function setDatesInRoom(guest: GuestStays, roomId: string, dates: string[]) {
  const stays = guestStays(guest)
  const current = stays.find(stay => stay.roomId === roomId)
  if (current) current.dates = dates
  else stays.push({ roomId, dates })
  writeGuestStays(guest, stays)
}
