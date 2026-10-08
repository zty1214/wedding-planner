import type { Guest, Table, Note, Room, RoomType, SharedLink } from './index.ts'

type SaveResult = void | Promise<boolean>

export interface WeddingState {
  projectId: string
  projectTitle: string
  mainStagePos: { x: number; y: number } | null
  guests: Guest[]
  tables: Table[]
  rooms: Room[]
  notes: Note[]
  customGroups: string[]
  stayDates: string[] // 项目级可选住宿晚次（ISO 日期），默认婚礼两晚
  sharedLinks: SharedLink[] // 我生成的分享链接（仅本地）

  // Project actions
  setProjectTitle: (title: string) => SaveResult
  setMainStagePos: (pos: { x: number; y: number }) => SaveResult

  // Shared-link actions（仅本地）
  addSharedLink: (link: SharedLink) => void
  renameSharedLink: (id: string, name: string) => void
  removeSharedLink: (id: string) => void

  // Guest actions
  addGuest: (name: string, group: string, phone?: string) => SaveResult
  updateGuest: (id: string, patch: Partial<Guest>) => SaveResult
  removeGuest: (id: string) => void
  assignGuestToTable: (guestId: string, tableId: string | null, seatIndex: number | null) => void
  swapGuestSeats?: (firstId: string, secondId: string) => void
  assignGuestToRoom: (guestId: string, roomId: string | null) => void | Promise<boolean>
  setGuestStayNeed?: (id: string, value: 'pending' | 'needed' | 'not_needed') => void
  setGuestStayDates: (guestId: string, dates: string[]) => void
  addCustomGroup: (group: string) => SaveResult

  // Table actions
  addTable: (seats: number, x: number, y: number) => void
  updateTable: (id: string, patch: Partial<Table>) => SaveResult
  removeTable: (id: string) => void

  // Room actions
  addRoom: (type: RoomType) => void | Promise<string | null>
  arrangeRoom?: (roomId: string, guestIds: string[], dates: string[]) => Promise<boolean>
  updateRoom: (id: string, patch: Partial<Room>) => void | Promise<boolean>
  removeRoom: (id: string) => void

  // Stay-date actions
  addStayDate: (date: string) => void
  removeStayDate: (date: string) => void
  setStayDates: (dates: string[]) => void

  // Note actions
  addNote: (category: string, title: string, content: string, images: string[]) => SaveResult
  updateNote: (id: string, patch: Partial<Note>) => SaveResult
  removeNote: (id: string) => void
}
