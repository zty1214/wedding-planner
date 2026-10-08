/** Structured business state; layout is coordinates and relationships, never an image. */
export type CoreGuest = {
  id: string; revision: number; name: string; group: string; phone: string; notes: string
  side: 'unset' | 'bride' | 'groom' | 'shared'; attendance: 'pending' | 'confirmed' | 'declined'
  tableId: string | null; seatIndex: number | null; roomId: string | null
  stayNeed: 'pending' | 'needed' | 'not_needed'; stayDates: string[]
}
export type CoreTable = { id: string; revision: number; label: string; seats: number; x: number; y: number; rotation: number }
export type CoreRoom = { id: string; revision: number; label: string; type: '大床房' | '标间'; notes: string; stayDates?: string[] }
export type Core = {
  retiredIds?: string[]
  schemaVersion: 2
  guestOrder: string[]; tableOrder: string[]; roomOrder: string[]
  guests: Record<string, CoreGuest>; tables: Record<string, CoreTable>; rooms: Record<string, CoreRoom>
  config: { revision: number; title: string; mainStagePos: { x: number; y: number } | null; customGroups: string[]; stayDates: string[] }
}
export function emptyCore(): Core {
  return { schemaVersion: 2, guestOrder: [], tableOrder: [], roomOrder: [], guests: {}, tables: {}, rooms: {},
    config: { revision: 0, title: '备婚助手', mainStagePos: null, customGroups: [], stayDates: [] } }
}
