import type { Core, CoreGuest } from '../../src/fusion/core.ts'
import { canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
import type { CommandHandler as Handler } from '../../src/fusion/protocol.ts'

const invalid = (): never => { throw new CommandError('INVALID_INPUT') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid()
  return value as Record<string, unknown>
}
function fields(p: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(p, k)) || Object.keys(p).some(k => ![...required, ...optional].includes(k))) invalid()
}
function text(v: unknown, nonempty = false): string {
  if (typeof v !== 'string' || (nonempty && !v.trim())) return invalid()
  return v
}
function id(v: unknown): string {
  const s = text(v, true)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(s) || ['constructor', 'prototype', '__proto__'].includes(s)) return invalid()
  return s
}
function finite(v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v)) return invalid(); return v }
function dates(v: unknown): string[] {
  if (!Array.isArray(v)) return invalid()
  const result = v.map(x => {
    const s = text(x)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) return invalid()
    return s
  })
  return [...new Set(result)].sort()
}
function expected(command: Command, key: string, revision: number) {
  if (command.expectedRevisions[key] !== revision) throw new CommandError('CONFLICT')
}
function uniqueRoomLabel(core: Core, label: string, except?: string) {
  if (Object.values(core.rooms).some(room => room.id !== except && room.label.trim() === label.trim())) throw new CommandError('CONFLICT')
}
function entity<T extends { revision: number }>(items: Record<string, T>, key: string): T {
  if (!Object.hasOwn(items, key)) throw new CommandError('NOT_FOUND')
  return items[key]
}
function touch<T extends { revision: number }>(target: T, change: () => void) {
  const before = canonicalJson(target)
  change()
  if (before !== canonicalJson(target)) target.revision++
}
/** Reject malformed persisted state before a command can report a false successful write. */
export function assertCore(value: unknown): asserts value is Core {
  const c = record(value)
  if (c.schemaVersion !== 2) invalid()
  if (c.retiredIds !== undefined && (!Array.isArray(c.retiredIds) || c.retiredIds.some(x => typeof x !== 'string'))) invalid()
  const guests = record(c.guests), tables = record(c.tables), rooms = record(c.rooms), config = record(c.config)
  for (const [order, items] of [[c.guestOrder, guests], [c.tableOrder, tables], [c.roomOrder, rooms]] as const) {
    if (!Array.isArray(order) || order.some(key => typeof key !== 'string' || !Object.hasOwn(items, key))
      || new Set(order).size !== order.length || order.length !== Object.keys(items).length) invalid()
  }
  const revision = (v: unknown) => { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) >= Number.MAX_SAFE_INTEGER) invalid() }
  const strings = (v: unknown) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) invalid() }
  revision(config.revision); text(config.title); strings(config.customGroups)
  if (canonicalJson(dates(config.stayDates)) !== canonicalJson(config.stayDates)) invalid()
  if (config.mainStagePos !== null) { const pos = record(config.mainStagePos); finite(pos.x); finite(pos.y) }
  for (const [key, value] of Object.entries(tables)) {
    const t = record(value); if (id(t.id) !== key) invalid()
    revision(t.revision); text(t.label); finite(t.x); finite(t.y); finite(t.rotation)
    if (!Number.isSafeInteger(t.seats) || Number(t.seats) <= 0) invalid()
  }
  for (const [key, value] of Object.entries(rooms)) {
    const r = record(value); if (id(r.id) !== key) invalid()
    revision(r.revision); text(r.label); text(r.notes)
    if (r.type !== '大床房' && r.type !== '标间') invalid()
    if (r.stayDates !== undefined && (canonicalJson(dates(r.stayDates)) !== canonicalJson(r.stayDates)
      || (r.stayDates as string[]).some(d => !(config.stayDates as string[]).includes(d)))) invalid()
  }
  const occupied = new Set<string>()
  for (const [key, value] of Object.entries(guests)) {
    const g = record(value); if (id(g.id) !== key) invalid()
    revision(g.revision)
    for (const field of ['name', 'group', 'phone', 'notes']) text(g[field])
    if (!['unset', 'bride', 'groom', 'shared'].includes(text(g.side))
      || !['pending', 'confirmed', 'declined'].includes(text(g.attendance))
      || !['pending', 'needed', 'not_needed'].includes(text(g.stayNeed))) invalid()
    if (g.tableId === null) { if (g.seatIndex !== null) invalid() }
    else {
      const table = record(tables[id(g.tableId)])
      if (g.attendance === 'declined' || !Number.isSafeInteger(g.seatIndex) || Number(g.seatIndex) < 0 || Number(g.seatIndex) >= Number(table.seats)) invalid()
      const seat = canonicalJson([g.tableId, g.seatIndex])
      if (occupied.has(seat)) invalid()
      occupied.add(seat)
    }
    const selected = dates(g.stayDates)
    if (canonicalJson(selected) !== canonicalJson(g.stayDates)
      || selected.some(d => !(config.stayDates as string[]).includes(d))) invalid()
    if (g.roomId === null) { if (selected.length) invalid() }
    else if (!Object.hasOwn(rooms, id(g.roomId)) || g.stayNeed !== 'needed') invalid()
  }
}
/** Initial non-destructive vertical slice. Deletion waits for atomic recycle material. */
export function coreHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const add = (type: string, apply: (core: Core, payload: Record<string, unknown>, command: Command) => void) => handlers.set(type, {
    apply(data: Json, command: Command): Json {
      assertCore(data)
      const core = structuredClone(data)
      apply(core, record(command.payload), command)
      assertCore(core)
      return core
    },
  })
  const guest = (c: Core, p: Record<string, unknown>, cmd: Command): CoreGuest => {
    const key = id(p.id), g = entity(c.guests, key)
    expected(cmd, `guest:${key}`, g.revision)
    return g
  }
  add('guest.add', (c, p) => {
    fields(p, ['id', 'name', 'group'], ['phone', 'notes'])
    const key = id(p.id)
    if (c.retiredIds?.includes('guests:' + key) || Object.hasOwn(c.guests, key)) throw new CommandError('CONFLICT')
    c.guestOrder.push(key)
    c.guests[key] = { id: key, revision: 0, name: text(p.name, true), group: text(p.group),
      phone: p.phone === undefined ? '' : text(p.phone), notes: p.notes === undefined ? '' : text(p.notes),
      side: 'unset', attendance: 'pending', tableId: null, seatIndex: null, roomId: null, stayNeed: 'pending', stayDates: [] }
  })
  add('guest.update', (c, p, cmd) => {
    fields(p, ['id', 'patch']); const patch = record(p.patch)
    fields(patch, [], ['name', 'group', 'phone', 'notes', 'side', 'attendance'])
    const g = guest(c, p, cmd)
    touch(g, () => {
      for (const k of ['name', 'group', 'phone', 'notes'] as const) if (Object.hasOwn(patch, k)) g[k] = text(patch[k], k === 'name')
      if (Object.hasOwn(patch, 'side')) {
        if (typeof patch.side !== 'string' || !['unset', 'bride', 'groom', 'shared'].includes(patch.side)) invalid()
        g.side = patch.side as CoreGuest['side']
      }
      if (Object.hasOwn(patch, 'attendance')) {
        if (typeof patch.attendance !== 'string' || !['pending', 'confirmed', 'declined'].includes(patch.attendance)) invalid()
        g.attendance = patch.attendance as CoreGuest['attendance']
        if (g.attendance === 'declined') { g.tableId = null; g.seatIndex = null }
      }
    })
  })
  add('table.add', (c, p) => {
    fields(p, ['id', 'label', 'seats', 'x', 'y'], ['rotation']); const key = id(p.id), seats = finite(p.seats)
    if (!Number.isSafeInteger(seats) || seats <= 0) invalid()
    if (c.retiredIds?.includes('tables:' + key) || Object.hasOwn(c.tables, key)) throw new CommandError('CONFLICT')
    c.tableOrder.push(key)
    c.tables[key] = { id: key, revision: 0, label: text(p.label, true), seats, x: finite(p.x), y: finite(p.y), rotation: p.rotation === undefined ? 0 : finite(p.rotation) }
  })
  add('table.move', (c, p, cmd) => {
    fields(p, ['id', 'x', 'y'], ['rotation']); const key = id(p.id), t = entity(c.tables, key)
    expected(cmd, `table:${key}`, t.revision)
    touch(t, () => { t.x = finite(p.x); t.y = finite(p.y); if (p.rotation !== undefined) t.rotation = finite(p.rotation) })
  })
  add('table.update', (c, p, cmd) => {
    fields(p, ['id', 'patch']); const key = id(p.id), t = entity(c.tables, key), patch = record(p.patch)
    fields(patch, [], ['label', 'seats', 'x', 'y', 'rotation']); expected(cmd, `table:${key}`, t.revision)
    touch(t, () => {
      if (patch.label !== undefined) t.label = text(patch.label, true)
      for (const k of ['x', 'y', 'rotation'] as const) if (patch[k] !== undefined) t[k] = finite(patch[k])
      if (patch.seats !== undefined) {
        const seats = finite(patch.seats)
        if (!Number.isSafeInteger(seats) || seats <= 0) invalid()
        if (Object.values(c.guests).some(g => g.tableId === key && g.seatIndex! >= seats)) throw new CommandError('CONFLICT')
        t.seats = seats
      }
    })
  })
  add('room.update', (c, p, cmd) => {
    fields(p, ['id', 'patch']); const key = id(p.id), r = entity(c.rooms, key), patch = record(p.patch)
    fields(patch, [], ['label', 'notes']); expected(cmd, `room:${key}`, r.revision)
    if (patch.label !== undefined) uniqueRoomLabel(c, text(patch.label, true), key)
    touch(r, () => { if (patch.label !== undefined) r.label = text(patch.label, true).trim(); if (patch.notes !== undefined) r.notes = text(patch.notes) })
  })
  add('project.update', (c, p, cmd) => {
    fields(p, ['patch']); const patch = record(p.patch)
    fields(patch, [], ['title', 'mainStagePos']); expected(cmd, 'config', c.config.revision)
    touch(c.config, () => {
      if (patch.title !== undefined) c.config.title = text(patch.title, true)
      if (patch.mainStagePos !== undefined) {
        const pos = record(patch.mainStagePos); fields(pos, ['x', 'y'])
        c.config.mainStagePos = { x: finite(pos.x), y: finite(pos.y) }
      }
    })
  })
  add('group.add', (c, p, cmd) => {
    fields(p, ['group']); expected(cmd, 'config', c.config.revision); const group = text(p.group, true)
    touch(c.config, () => { if (!c.config.customGroups.includes(group)) c.config.customGroups.push(group) })
  })
  add('guest.assign', (c, p, cmd) => {
    fields(p, ['id', 'tableId', 'seatIndex']); const g = guest(c, p, cmd)
    const tableId = id(p.tableId), t = entity(c.tables, tableId), seat = finite(p.seatIndex)
    expected(cmd, `table:${tableId}`, t.revision)
    if (g.attendance === 'declined' || !Number.isSafeInteger(seat) || seat < 0 || seat >= t.seats) invalid()
    if (Object.values(c.guests).some(other => other.id !== g.id && other.tableId === tableId && other.seatIndex === seat)) throw new CommandError('SEAT_OCCUPIED')
    touch(g, () => { g.tableId = tableId; g.seatIndex = seat })
  })
  add('guest.swapSeats', (c, p, cmd) => {
    fields(p, ['firstId', 'secondId'])
    const first = guest(c, { id: p.firstId }, cmd), second = guest(c, { id: p.secondId }, cmd)
    if (first.id === second.id || first.tableId === null || second.tableId === null) invalid()
    for (const g of [first, second]) expected(cmd, `table:${g.tableId}`, entity(c.tables, g.tableId!).revision)
    const seat = { tableId: first.tableId, seatIndex: first.seatIndex }
    touch(first, () => { first.tableId = second.tableId; first.seatIndex = second.seatIndex })
    touch(second, () => { second.tableId = seat.tableId; second.seatIndex = seat.seatIndex })
  })
  add('guest.unassign', (c, p, cmd) => {
    fields(p, ['id']); const g = guest(c, p, cmd)
    touch(g, () => { g.tableId = null; g.seatIndex = null })
  })
  add('room.add', (c, p) => {
    fields(p, ['id', 'label', 'type'], ['notes']); const key = id(p.id)
    uniqueRoomLabel(c, text(p.label, true))
    if (p.type !== '大床房' && p.type !== '标间') invalid()
    if (c.retiredIds?.includes('rooms:' + key) || Object.hasOwn(c.rooms, key)) throw new CommandError('CONFLICT')
    c.roomOrder.push(key)
    c.rooms[key] = { id: key, revision: 0, label: text(p.label, true).trim(), type: p.type as '大床房' | '标间', notes: p.notes === undefined ? '' : text(p.notes) }
  })
  // One command freezes room nights and all affected guests; no partial assignment.
  add('room.arrange', (c, p, cmd) => {
    fields(p, ['id', 'guestIds', 'dates'])
    const key = id(p.id), room = entity(c.rooms, key), selected = dates(p.dates)
    expected(cmd, `room:${key}`, room.revision); expected(cmd, 'config', c.config.revision)
    if (selected.some(date => !c.config.stayDates.includes(date)) || !Array.isArray(p.guestIds)) invalid()
    const ids = (p.guestIds as unknown[]).map(id)
    if (new Set(ids).size !== ids.length) invalid()
    const affected = [...new Set([...Object.values(c.guests).filter(g => g.roomId === key).map(g => g.id), ...ids])]
    // Detect occupants added by another command since this request was frozen.
    if (canonicalJson(Object.keys(cmd.expectedRevisions).filter(ref => ref.startsWith('guest:')).sort())
      !== canonicalJson(affected.map(guestId => `guest:${guestId}`).sort())) throw new CommandError('CONFLICT')
    for (const guestId of affected) expected(cmd, `guest:${guestId}`, entity(c.guests, guestId).revision)
    touch(room, () => { room.stayDates = selected })
    for (const guestId of affected) {
      const g = c.guests[guestId]
      touch(g, () => { g.roomId = key; g.stayNeed = 'needed'; g.stayDates = [...selected] })
    }
  })
  add('guest.setStayNeed', (c, p, cmd) => {
    fields(p, ['id', 'stayNeed']); const g = guest(c, p, cmd)
    if (!['pending', 'needed', 'not_needed'].includes(String(p.stayNeed))) invalid()
    if (g.roomId && p.stayNeed !== 'needed') throw new CommandError('INVALID_INPUT')
    touch(g, () => { g.stayNeed = p.stayNeed as CoreGuest['stayNeed'] })
  })
  add('guest.assignRoom', (c, p, cmd) => {
    fields(p, ['id', 'roomId']); const g = guest(c, p, cmd), roomId = p.roomId === null ? null : id(p.roomId)
    // Clearing an existing stay is deferred until recovery material is atomic.
    if (g.roomId !== null && roomId === null) throw new CommandError('INVALID_INPUT')
    if (roomId !== null) { const r = entity(c.rooms, roomId); expected(cmd, `room:${roomId}`, r.revision) }
    touch(g, () => { g.roomId = roomId; if (roomId) { g.stayNeed = 'needed'; if (c.rooms[roomId].stayDates) g.stayDates = [...c.rooms[roomId].stayDates!] } else g.stayDates = [] })
  })
  add('stayDate.add', (c, p, cmd) => {
    fields(p, ['date']); expected(cmd, 'config', c.config.revision)
    const [date] = dates([p.date])
    touch(c.config, () => { c.config.stayDates = [...new Set([...c.config.stayDates, date])].sort() })
  })
  add('guest.setStayDates', (c, p, cmd) => {
    fields(p, ['id', 'dates']); const g = guest(c, p, cmd), selected = dates(p.dates)
    if (g.roomId && c.rooms[g.roomId].stayDates !== undefined) invalid() // Updated rooms use room.arrange atomically.
    expected(cmd, 'config', c.config.revision)
    if ((!g.roomId && selected.length) || selected.some(d => !c.config.stayDates.includes(d))) invalid()
    touch(g, () => { g.stayDates = selected })
  })
  return handlers
}
