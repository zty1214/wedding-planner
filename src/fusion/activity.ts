import { canonicalJson, CommandError } from './protocol.ts'
import type { Command, Json } from './protocol.ts'
export const activityCategories = ['guests', 'seating', 'stay', 'notes', 'layout', 'project', 'unclassified'] as const
export const activityChanges = ['added', 'adjusted', 'deleted', 'restored', 'unclassified'] as const
export type ActivityCategory = typeof activityCategories[number]
export type ActivityChange = typeof activityChanges[number]
export type ActivityDelta = { category: ActivityCategory; change: ActivityChange; affectedGuests: number }
export type ActivityDay = { day: string; count: number; categories: Record<ActivityCategory, number>; changes: Record<ActivityChange, number>; affectedGuests: number }
export type SnapshotState = 'today' | 'ready' | 'expired' | 'pending' | 'failed' | 'none'
export type ActivityMonth = { month: string; today: string; days: { activity: ActivityDay; snapshot: SnapshotState }[] }
const nonnegative = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
export function monthDays(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 9999) throw new CommandError('INVALID_INPUT')
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
export function decodeActivity(day: string, value: unknown): ActivityDay {
  const v = value as Partial<ActivityDay> | null
  if (v !== null && (!v || typeof v !== 'object' || v.day !== day || !nonnegative(v.count))) throw Error('INVALID_ACTIVITY_DOCUMENT')
  const count = v?.count ?? 0
  const categories = Object.fromEntries(activityCategories.map(k => [k, k === 'unclassified' ? count : 0])) as ActivityDay['categories']
  const changes = Object.fromEntries(activityChanges.map(k => [k, k === 'unclassified' ? count : 0])) as ActivityDay['changes']
  if (v?.categories !== undefined || v?.changes !== undefined || v?.affectedGuests !== undefined) {
    if (!v.categories || !v.changes || !nonnegative(v.affectedGuests)
      || activityCategories.some(k => !nonnegative(v.categories![k])) || activityChanges.some(k => !nonnegative(v.changes![k]))
      || activityCategories.reduce((n, k) => n + v.categories![k], 0) !== count
      || activityChanges.reduce((n, k) => n + v.changes![k], 0) !== count) throw Error('INVALID_ACTIVITY_DOCUMENT')
    return { day, count, categories: { ...v.categories }, changes: { ...v.changes }, affectedGuests: v.affectedGuests }
  }
  return { day, count, categories, changes, affectedGuests: 0 }
}
export function incrementActivity(old: ActivityDay, delta: ActivityDelta): ActivityDay {
  const next = structuredClone(old)
  next.count++; next.categories[delta.category]++; next.changes[delta.change]++; next.affectedGuests += delta.affectedGuests
  return decodeActivity(old.day, next)
}
/** One complete command has one primary category; impacted people are touches, not unique participants. */
export function describeActivity(c: Pick<Command, 'type' | 'payload'>, before?: Json, after?: Json, restoredType?: string): ActivityDelta {
  const type = restoredType ?? c.type
  let category: ActivityCategory = 'unclassified'
  if (type.startsWith('note.')) category = 'notes'
  else if (type.startsWith('room.') || type.startsWith('stayDate.') || ['guest.assignRoom', 'guest.clearRoom', 'guest.setStayNeed', 'guest.clearStayNeed', 'guest.setStayDates'].includes(type)) category = 'stay'
  else if (['guest.assign', 'guest.unassign', 'guest.swapSeats'].includes(type)) category = 'seating'
  else if (type.startsWith('table.')) category = 'layout'
  else if (type.startsWith('guest.') || type === 'group.add') category = 'guests'
  else if (type === 'project.update') {
    const p = c.payload as { patch?: Record<string, unknown> }
    category = p?.patch && Object.keys(p.patch).every(k => k === 'mainStagePos') ? 'layout' : 'project'
  } else if (type === 'version.restore') category = 'project'
  const change: ActivityChange = c.type.endsWith('.restore') ? 'restored' : category === 'unclassified' ? 'unclassified'
    : type.endsWith('.add') ? 'added' : /delete|clear|\.remove$/.test(type) ? 'deleted' : 'adjusted'
  const guests = (v?: Json): Record<string, Json> => v && typeof v === 'object' && !Array.isArray(v) && v.schemaVersion === 2 ? v.guests as Record<string, Json> : {}
  const a = guests(before), b = guests(after)
  const affectedGuests = new Set([...Object.keys(a), ...Object.keys(b)].filter(id => canonicalJson(a[id] ?? null) !== canonicalJson(b[id] ?? null))).size
  return { category, change, affectedGuests }
}
export function assertActivityMonth(value: unknown): asserts value is ActivityMonth {
  if (!value || typeof value !== 'object') throw Error('INVALID_ACTIVITY_RESPONSE')
  const m = value as ActivityMonth
  if (typeof m.month !== 'string' || typeof m.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.today) || !Array.isArray(m.days)) throw Error('INVALID_ACTIVITY_RESPONSE')
  const dates = monthDays(m.month)
  if (m.days.length !== dates.length) throw Error('INVALID_ACTIVITY_RESPONSE')
  m.days.forEach((d, i) => {
    if (!d || !d.activity || !['today', 'ready', 'expired', 'pending', 'failed', 'none'].includes(d.snapshot)) throw Error('INVALID_ACTIVITY_RESPONSE')
    decodeActivity(dates[i], d.activity)
  })
}
