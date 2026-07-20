export interface Guest {
  id: string
  name: string
  group: string
  phone?: string
  notes?: string
  tableId: string | null
  seatIndex: number | null
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
