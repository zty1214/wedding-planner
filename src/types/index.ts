export interface Guest {
  id: string
  name: string
  group: string
  phone?: string
  notes?: string
  tableId: string | null
  seatIndex: number | null
  roomId: string | null // 住宿房间（与座位独立），null 表示暂不安排住宿
  stayNeed?: 'pending' | 'needed' | 'not_needed' // 新内核独立住宿需求
  stayDates: string[] // 入住的晚次（ISO 日期 'YYYY-MM-DD'），仅当 roomId 非空时有意义
  attendance?: 'pending' | 'confirmed' | 'declined'
  side?: 'unset' | 'bride' | 'groom' | 'shared'
  status: 'unassigned' | 'assigned' | 'confirmed' // 未分配 / 已分配待确认 / 确认出席
}

export interface Table {
  id: string
  label: string
  x: number
  y: number
  seats: number // 8 / 10 / 12
  rotation: number
}

// 房型：大床房（按 1 间 1 户处理）/ 标间（固定 2 个床位）
export type RoomType = '大床房' | '标间'

export interface Room {
  id: string
  type: RoomType
  label: string // 房号，如「大床房1」
  notes?: string
}

// 「我生成的分享链接」——仅存本地浏览器，用于记录你为朋友新建的独立项目，不参与云端同步
export interface SharedLink {
  id: string // 项目的 projectId
  name: string // 备注名，如「小王婚礼」
  createdAt: string
}

export const ROOM_TYPES: RoomType[] = ['大床房', '标间']

// 每种房型建议容纳人数：大床房按户（1-2 人，建议 2），标间固定 2 人
export const ROOM_CAPACITY: Record<RoomType, number> = {
  大床房: 2,
  标间: 2,
}

export interface Note {
  id: string
  category: string
  title: string
  content: string
  images: string[] // base64 or URLs
  createdAt: string
  updatedAt: string
}

export type NoteCategory = '酒店' | '婚庆' | '试妆' | '其他'

export const NOTE_CATEGORIES: NoteCategory[] = ['酒店', '婚庆', '试妆', '其他']

export const DEFAULT_GUEST_GROUPS = [
  '新郎亲属',
  '新娘亲属',
  '新郎同学',
  '新郎同事',
  '新娘同学',
  '新郎妈妈同学',
]

export const TABLE_PRESETS = [
  { seats: 8, label: '8人桌', radius: 50 },
  { seats: 10, label: '10人桌', radius: 60 },
  { seats: 12, label: '12人桌', radius: 70 },
]
