import type { Pending } from './outbox.ts'
import type { ProjectSnapshot } from './repository.ts'

export function describePayload(item: Pending, snapshot: ProjectSnapshot | null): string {
  const labels: Record<string, string> = { name: '姓名', group: '分组', phone: '电话', notes: '备注', title: '标题', content: '正文', category: '分类',
    stayDates: '住宿晚次', customGroups: '自定义分组', createdAt: '创建时间', updatedAt: '更新时间', tableId: '桌位', roomId: '房间', seatIndex: '座号', dates: '住宿晚次', date: '晚次', stayNeed: '住宿需求', attendance: '出席状态', side: '归属',
    label: '名称', seats: '座位数', x: '横向位置', y: '纵向位置', rotation: '旋转角度', mainStagePos: '舞台位置', type: '房型', firstId: '第一位宾客', secondId: '第二位宾客' }
  const enums: Record<string, string> = { pending: '待确认', needed: '需要', not_needed: '不需要', confirmed: '已确认', declined: '不出席', unset: '未设置', bride: '女方', groom: '男方', shared: '共同' }
  function value(key: string, v: unknown): string {
    if (v === null) return '清除'
    if (key === 'seatIndex' && typeof v === 'number') return String(v + 1)
    if (typeof v === 'string') {
      if (key === 'tableId') return snapshot?.data.tables[v]?.label ?? '原桌位当前不可见'
      if (key === 'roomId') return snapshot?.data.rooms[v]?.label ?? '原房间当前不可见'
      if (key === 'firstId' || key === 'secondId') return snapshot?.data.guests[v]?.name ?? '原宾客当前不可见'
      return ['stayNeed', 'attendance', 'side'].includes(key) ? enums[v] ?? v : v || '（空）'
    }
    if (Array.isArray(v)) return v.join('、') || '清空'
    if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${labels[k] ?? k}：${value(k, x)}`).join('；')
    return String(v)
  }
  if (snapshot?.dataEpoch !== item.command.dataEpoch) snapshot = null
  const payload = item.command.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '请导出草稿查看完整内容。'
  const id = typeof payload.id === 'string' ? payload.id : ''
  const kind = item.command.type.split('.')[0]
  const target = kind === 'guest' ? snapshot?.data.guests[id]?.name : kind === 'table' ? snapshot?.data.tables[id]?.label : kind === 'room' ? snapshot?.data.rooms[id]?.label : kind === 'note' ? snapshot?.notes?.find(n => n.id === id)?.title : undefined
  const entries = Object.entries(payload).filter(([k]) => k !== 'id').flatMap(([k, v]) => k === 'patch' && v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : [[k, v]])
  return [target ? `对应记录：${target}` : id && !item.command.type.endsWith('.add') ? '对应记录请结合当前安排或导出的草稿核对。' : '',
    ...entries.map(([k, v]) => `${labels[String(k)] ?? k}：${value(String(k), v)}`)].filter(Boolean).join('\n')
}
/** Compare against an explicitly fetched confirmed snapshot, never an optimistic view. */
export function describeCurrent(item: Pending, current: ProjectSnapshot): string {
  if (item.command.dataEpoch !== current.dataEpoch) return '项目已恢复到其他数据代次。原草稿不能直接覆盖当前安排，请逐项重新核对。'
  const payload = item.command.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '请在对应页面核对当前安排。'
  const kind = item.command.type.split('.')[0], id = typeof payload.id === 'string' ? payload.id : ''
  const describe = (entity: object, type = item.command.type) => {
    const { revision, ...fields } = entity as Record<string, import('./protocol.ts').Json>
    return `记录版本：${revision}\n` + describePayload({ ...item, command: { ...item.command, type, payload: fields } }, current)
  }
  if (item.command.type === 'guest.swapSeats') return [payload.firstId, payload.secondId].map(key => typeof key === 'string' && Object.hasOwn(current.data.guests, key) ? describe(current.data.guests[key]) : '原宾客当前不存在').join('\n\n')
  if (['project', 'group', 'stayDate'].includes(kind)) return describe(current.data.config)
  const entities = kind === 'guest' ? current.data.guests : kind === 'table' ? current.data.tables : kind === 'room' ? current.data.rooms : null
  const entity = entities && Object.hasOwn(entities, id) ? entities[id] : kind === 'note' ? current.notes?.find(note => note.id === id) : undefined
  if (!entity) return ['guest', 'table', 'room', 'note'].includes(kind) ? kind === 'note' && !current.notes ? '当前笔记内容未完整读取，请重试。' : item.command.type.endsWith('.add') ? '当前没有此记录；需结合前序草稿判断新增依赖。' : '此记录当前不存在，不能直接按原记录继续编辑。' : '此操作涉及历史或回收内容，请在历史页面核对预览。'
  const sections = [describe(entity)]
  if (item.command.type === 'table.deleteWithGuests' || item.command.type === 'room.deleteWithAssignments') {
    const guests = current.data.guestOrder.map(key => current.data.guests[key]).filter(g => kind === 'table' ? g.tableId === id : g.roomId === id)
    sections.push(`当前关联宾客（${guests.length} 人）：`, ...guests.map(guest => describe(guest, 'guest.update')))
  }
  return sections.join('\n\n')
}
