import type { Core, CoreGuest } from './core.ts'
import { CommandError } from './protocol.ts'
import { DEFAULT_GUEST_GROUPS, TRAVEL_LABELS } from '../types/index.ts'

export const GUEST_SHEET = '宾客名单'
export const GUEST_COLUMNS = ['姓名', '电话', '分组标签', '出席状态', '住宿需求', '桌号/桌名', '备注', '宾客编号'] as const
export const GUEST_EXPORT_COLUMNS = [...GUEST_COLUMNS, '户名', '出行方式'] as const
export const MAX_GUEST_ROWS = 500
export const ATTENDANCE_LABELS = { pending: '待确认', confirmed: '已确认', declined: '不出席' } as const
export const STAY_NEED_LABELS = { pending: '待确认', needed: '需要住宿', not_needed: '不需要住宿' } as const

export type GuestRosterRow = Pick<CoreGuest, 'name' | 'phone' | 'group' | 'notes' | 'attendance' | 'stayNeed' | 'travelMode'> & { id: string | null }
type GuestChange = Omit<GuestRosterRow, 'id'>
type RosterPlan = { added: GuestChange[]; updated: { id: string; row: GuestChange }[]; removed: CoreGuest[] }

class GuestRosterIssue extends CommandError {
  constructor(message: string) { super('INVALID_INPUT'); this.message = message }
}
const fields = ['name', 'phone', 'group', 'notes', 'attendance', 'stayNeed'] as const
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) && !['constructor', 'prototype'].includes(value)

/** Only roster fields are writable from Excel. The same check runs for preview and in the write transaction. */
export function planGuestRoster(core: Core, input: unknown): RosterPlan {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_GUEST_ROWS) throw new GuestRosterIssue(`请提供 1–${MAX_GUEST_ROWS} 位宾客；空表不能清空名单。`)
  const plan: RosterPlan = { added: [], updated: [], removed: [] }, seen = new Set<string>()
  for (const [index, value] of input.entries()) {
    const bad = (reason: string): never => { throw new GuestRosterIssue(`第 ${index + 1} 条宾客记录：${reason}`) }
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).some(key => !['id', 'travelMode', ...fields].includes(key))
      || !['id', ...fields].every(key => Object.hasOwn(value, key))) bad('字段不符合宾客名单模板。')
    const r = value as GuestRosterRow
    if (r.travelMode !== undefined && (typeof r.travelMode !== 'string' || !Object.hasOwn(TRAVEL_LABELS, r.travelMode))) bad('出行方式不符合模板。')
    if (typeof r.name !== 'string' || !r.name.trim() || [r.phone, r.group, r.notes].some(x => typeof x !== 'string')) bad('姓名必填，电话、分组和备注请填写文本。')
    if (![r.attendance, r.stayNeed].every(v => typeof v === 'string') || !Object.hasOwn(ATTENDANCE_LABELS, r.attendance) || !Object.hasOwn(STAY_NEED_LABELS, r.stayNeed)) bad('出席状态或住宿需求不符合模板。')
    const { id, ...patch } = r
    if (id === null) { plan.added.push(patch); continue }
    if (!validId(id) || !Object.hasOwn(core.guests, id)) bad('宾客编号不存在于当前项目。新增宾客请留空编号。')
    if (seen.has(id!)) bad('宾客编号重复，请保留一行。')
    seen.add(id!)
    const old = core.guests[id!]
    if (old.tableId && patch.attendance === 'declined') bad('已有座位，不能通过导入改为不出席。请先在系统内处理座位。')
    if (old.roomId && patch.stayNeed !== 'needed') bad('已有住宿安排，不能通过导入取消住宿需求。请先在系统内处理房间。')
    if (fields.some(field => patch[field] !== old[field]) || (r.travelMode !== undefined && r.travelMode !== (old.travelMode ?? 'pending'))) plan.updated.push({ id: id!, row: patch })
  }
  plan.removed = core.guestOrder.filter(id => !seen.has(id)).map(id => core.guests[id])
  return plan
}

export function applyGuestRoster(core: Core, plan: RosterPlan, makeId: () => string): Core {
  const next = structuredClone(core)
  const removed = new Set(plan.removed.map(g => g.id))
  next.guestOrder = next.guestOrder.filter(id => !removed.has(id))
  if (removed.size) next.retiredIds = [...new Set([...(next.retiredIds ?? []), ...[...removed].map(id => `guests:${id}`)])]
  for (const id of removed) delete next.guests[id]
  for (const { id, row } of plan.updated) next.guests[id] = { ...next.guests[id], ...row, revision: next.guests[id].revision + 1 }
  for (const row of plan.added) {
    const id = makeId()
    if (!validId(id) || Object.hasOwn(next.guests, id) || next.retiredIds?.includes(`guests:${id}`)) throw new CommandError('CONFLICT')
    next.guestOrder.push(id)
    next.guests[id] = { ...row, id, revision: 0, side: 'unset', tableId: null, seatIndex: null, roomId: null, stayDates: [] }
  }
  const known = new Set([...DEFAULT_GUEST_GROUPS, ...next.config.customGroups])
  for (const { group } of [...plan.added, ...plan.updated.map(x => x.row)]) {
    if (group.trim() && !known.has(group)) { next.config.customGroups.push(group); known.add(group) }
  }
  if (next.config.customGroups.length !== core.config.customGroups.length) next.config.revision++
  return next
}
