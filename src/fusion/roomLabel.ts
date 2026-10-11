import type { Room, RoomType } from '../types/index.ts'

/** Continue each room type's sequence without renaming existing arrangements. */
export function nextRoomLabel(rooms: Pick<Room, 'label' | 'type'>[], type: RoomType): string {
  const sameType = rooms.filter(room => room.type === type)
  const pattern = new RegExp(`^${type}\\s*(\\d+)$`)
  const numbers = sameType.map(room => Number(pattern.exec(room.label.trim())?.[1] ?? 0)).filter(Number.isSafeInteger)
  let number = Math.max(sameType.length, ...numbers) + 1
  const used = new Set(rooms.map(room => room.label.trim()))
  while (used.has(`${type}${number}`)) number++
  return `${type}${number}`
}
