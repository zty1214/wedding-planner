import type { Core, CoreGuest, CoreRoom } from '../../src/fusion/core.ts'
import { adjacentEmptySeats, newGuest } from '../../src/fusion/households.ts'
import { guestStays, setDatesInRoom, stayInRoom, writeGuestStays } from '../../src/fusion/guestStays.ts'
import { MAX_GUEST_ROWS } from '../../src/fusion/guestRoster.ts'
import { FUSION_ROOM_TYPES, TRAVEL_LABELS } from '../../src/types/index.ts'
import type { RoomType, TravelMode } from '../../src/types/index.ts'
import { canonicalJson, CommandError, HOUSEHOLD_RECONCILE } from '../../src/fusion/protocol.ts'
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
function ids(v: unknown, max = MAX_GUEST_ROWS): string[] {
  if (!Array.isArray(v) || !v.length || v.length > max) return invalid()
  const result = v.map(id)
  if (new Set(result).size !== result.length) invalid()
  return result
}
function roomType(v: unknown): RoomType {
  if (!FUSION_ROOM_TYPES.includes(v as RoomType)) return invalid()
  return v as RoomType
}
function travel(v: unknown): TravelMode {
  if (typeof v !== 'string' || !Object.hasOwn(TRAVEL_LABELS, v)) return invalid()
  return v as TravelMode
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
function requireFreeRoomNights(guest: CoreGuest, room: CoreRoom, selected: string[]) {
  if (room.reservedGuestIds && !room.reservedGuestIds.includes(guest.id)) throw new CommandError('CONFLICT')
  if (guestStays(guest).some(stay => stay.roomId !== room.id && stay.dates.some(date => selected.includes(date)))) throw new CommandError('CONFLICT')
}
function requireUnusedGuestId(c: Core, key: string) {
  if (c.retiredIds?.includes('guests:' + key) || Object.hasOwn(c.guests, key)) throw new CommandError('CONFLICT')
}
function insertGuest(c: Core, g: CoreGuest) {
  requireUnusedGuestId(c, g.id)
  c.guestOrder.push(g.id)
  c.guests[g.id] = g
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
  const configuredDates = config.stayDates as string[]
  if (config.twinGiftDate !== undefined && config.twinGiftDate !== null
    && (typeof config.twinGiftDate !== 'string' || !configuredDates.includes(config.twinGiftDate))) invalid()
  if (config.mainStagePos !== null) { const pos = record(config.mainStagePos); finite(pos.x); finite(pos.y) }
  for (const [key, value] of Object.entries(tables)) {
    const t = record(value); if (id(t.id) !== key) invalid()
    revision(t.revision); text(t.label); finite(t.x); finite(t.y); finite(t.rotation)
    if (!Number.isSafeInteger(t.seats) || Number(t.seats) <= 0) invalid()
  }
  const reservedGuests = new Map<string, string[]>()
  for (const [key, value] of Object.entries(rooms)) {
    const r = record(value); if (id(r.id) !== key) invalid()
    revision(r.revision); text(r.label); text(r.notes)
    roomType(r.type)
    if (r.reservedGuestIds !== undefined) {
      if (r.type !== '套房') invalid()
      reservedGuests.set(key, ids(r.reservedGuestIds, 2))
    }
    if (r.stayDates !== undefined && (canonicalJson(dates(r.stayDates)) !== canonicalJson(r.stayDates)
      || (r.stayDates as string[]).some(d => !configuredDates.includes(d)))) invalid()
  }
  const occupied = new Set<string>()
  const households = new Map<string, string>()
  for (const [key, value] of Object.entries(guests)) {
    const g = record(value); if (id(g.id) !== key) invalid()
    revision(g.revision)
    for (const field of ['name', 'group', 'phone', 'notes']) text(g[field])
    if (!['unset', 'bride', 'groom', 'shared'].includes(text(g.side))
      || !['pending', 'confirmed', 'declined'].includes(text(g.attendance))
      || !['pending', 'needed', 'not_needed'].includes(text(g.stayNeed))) invalid()
    if (g.travelMode !== undefined) travel(g.travelMode)
    if (g.household !== undefined) {
      const h = record(g.household); fields(h, ['id', 'name'])
      const householdId = id(h.id), name = text(h.name, true), previous = households.get(householdId)
      if (previous !== undefined && previous !== name) invalid()
      households.set(householdId, name)
    }
    if (g.tableId === null) { if (g.seatIndex !== null) invalid() }
    else {
      const table = record(tables[id(g.tableId)])
      if (g.attendance === 'declined' || !Number.isSafeInteger(g.seatIndex) || Number(g.seatIndex) < 0 || Number(g.seatIndex) >= Number(table.seats)) invalid()
      const seat = canonicalJson([g.tableId, g.seatIndex])
      if (occupied.has(seat)) invalid()
      occupied.add(seat)
    }
    if (g.roomId === null) {
      if (dates(g.stayDates).length || g.additionalRoomStays !== undefined) invalid()
      continue
    }
    if (g.stayNeed !== 'needed') invalid()
    const seenRooms = new Set<string>(), seenDates = new Set<string>()
    const assertStay = (value: unknown, nights: unknown) => {
      const roomId = id(value), selected = dates(nights)
      const reserved = reservedGuests.get(roomId)
      if (!Object.hasOwn(rooms, roomId) || seenRooms.has(roomId) || (reserved && !reserved.includes(key))
        || canonicalJson(selected) !== canonicalJson(nights)
        || selected.some(d => !configuredDates.includes(d) || seenDates.has(d))) invalid()
      seenRooms.add(roomId)
      for (const date of selected) seenDates.add(date)
    }
    assertStay(g.roomId, g.stayDates)
    if (g.additionalRoomStays !== undefined) {
      if (!Array.isArray(g.additionalRoomStays) || !g.additionalRoomStays.length) invalid()
      for (const value of g.additionalRoomStays as unknown[]) {
        const stay = record(value); fields(stay, ['roomId', 'dates'])
        assertStay(stay.roomId, stay.dates)
      }
    }
  }
}
/** Initial non-destructive vertical slice. Deletion waits for atomic recycle material. */
export function coreHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const add = (type: string, apply: (core: Core, payload: Record<string, unknown>, command: Command) => void, managementOnly = false) => handlers.set(type, {
    managementOnly,
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
    const g = newGuest(id(p.id), text(p.name, true), text(p.group))
    if (p.phone !== undefined) g.phone = text(p.phone)
    if (p.notes !== undefined) g.notes = text(p.notes)
    insertGuest(c, g)
  })
  add('guest.update', (c, p, cmd) => {
    fields(p, ['id', 'patch']); const patch = record(p.patch)
    fields(patch, [], ['name', 'group', 'phone', 'notes', 'side', 'attendance', 'travelMode'])
    const g = guest(c, p, cmd)
    touch(g, () => {
      for (const k of ['name', 'group', 'phone', 'notes'] as const) if (Object.hasOwn(patch, k)) g[k] = text(patch[k], k === 'name')
      if (Object.hasOwn(patch, 'travelMode')) g.travelMode = travel(patch.travelMode)
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
  const usedHouseholdIds = (c: Core) => new Set(Object.values(c.guests).flatMap(g => g.household ? [g.household.id] : []))
  add('household.create', (c, p) => {
    fields(p, ['id', 'name', 'group', 'guestIds'])
    const household = { id: id(p.id), name: text(p.name, true).trim() }, group = text(p.group)
    if (usedHouseholdIds(c).has(household.id)) throw new CommandError('CONFLICT')
    const members = ids(p.guestIds)
    for (const [index, member] of members.entries()) {
      const name = members.length === 1 ? household.name : household.name + (index + 1)
      insertGuest(c, { ...newGuest(member, name, group), household })
    }
  })
  add('household.setTravel', (c, p, cmd) => {
    fields(p, ['id', 'travelMode'])
    const key = id(p.id), mode = travel(p.travelMode)
    const members = Object.values(c.guests).filter(g => g.household?.id === key)
    if (!members.length || Object.keys(cmd.expectedRevisions).length !== members.length) throw new CommandError('CONFLICT')
    for (const g of members) expected(cmd, `guest:${g.id}`, g.revision)
    for (const g of members) touch(g, () => { g.travelMode = mode })
  })
  add(HOUSEHOLD_RECONCILE, (c, p, cmd) => {
    fields(p, ['households'])
    if (!Array.isArray(p.households) || !p.households.length || p.households.length > MAX_GUEST_ROWS) return invalid()
    const used = usedHouseholdIds(c)
    for (const value of p.households) {
      const update = record(value); fields(update, ['id', 'name', 'memberIds', 'additions'])
      const household = { id: id(update.id), name: text(update.name, true).trim() }
      if (used.has(household.id)) throw new CommandError('CONFLICT')
      used.add(household.id)
      const members = ids(update.memberIds).map(memberId => guest(c, { id: memberId }, cmd))
      if (members.some(g => g.household)) throw new CommandError('CONFLICT')
      if (!Array.isArray(update.additions) || update.additions.length + members.length > MAX_GUEST_ROWS
        || (update.additions.length && members.length !== 1)) return invalid()
      const anchor = members[0], adjacent = adjacentEmptySeats(c, anchor, update.additions.length)
      for (const g of members) touch(g, () => { g.household = household })
      for (const [index, item] of update.additions.entries()) {
        const addition = record(item); fields(addition, ['id', 'name'])
        const g = newGuest(id(addition.id), text(addition.name, true), anchor.group)
        g.side = anchor.side
        g.household = household
        const seat = adjacent[index]
        if (seat !== undefined) { g.tableId = anchor.tableId; g.seatIndex = seat }
        insertGuest(c, g)
      }
    }
  }, true)
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
    fields(patch, [], ['label', 'notes', 'type', 'reservedGuestIds']); expected(cmd, `room:${key}`, r.revision)
    if (patch.label !== undefined) uniqueRoomLabel(c, text(patch.label, true), key)
    touch(r, () => {
      if (patch.label !== undefined) r.label = text(patch.label, true).trim()
      if (patch.notes !== undefined) r.notes = text(patch.notes)
      if (patch.type !== undefined) r.type = roomType(patch.type)
      if (patch.reservedGuestIds !== undefined && r.type !== '套房') invalid()
      if (r.type !== '套房' || patch.reservedGuestIds === null) delete r.reservedGuestIds
      else if (patch.reservedGuestIds !== undefined) {
        const reserved = ids(patch.reservedGuestIds, 2)
        for (const guestId of reserved) entity(c.guests, guestId)
        if (Object.values(c.guests).some(g => stayInRoom(g, key) && !reserved.includes(g.id))) throw new CommandError('CONFLICT')
        r.reservedGuestIds = reserved
      }
    })
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
    const type = roomType(p.type)
    if (c.retiredIds?.includes('rooms:' + key) || Object.hasOwn(c.rooms, key)) throw new CommandError('CONFLICT')
    c.roomOrder.push(key)
    c.rooms[key] = { id: key, revision: 0, label: text(p.label, true).trim(), type, notes: p.notes === undefined ? '' : text(p.notes) }
  })
  // One command freezes room nights and all affected guests; no partial assignment.
  add('room.arrange', (c, p, cmd) => {
    fields(p, ['id', 'guestIds', 'dates'])
    const key = id(p.id), room = entity(c.rooms, key), selected = dates(p.dates)
    expected(cmd, `room:${key}`, room.revision); expected(cmd, 'config', c.config.revision)
    if (selected.some(date => !c.config.stayDates.includes(date)) || !Array.isArray(p.guestIds)) invalid()
    const ids = (p.guestIds as unknown[]).map(id)
    if (new Set(ids).size !== ids.length) invalid()
    const affected = [...new Set([...Object.values(c.guests).filter(g => stayInRoom(g, key)).map(g => g.id), ...ids])]
    // Detect occupants added by another command since this request was frozen.
    if (canonicalJson(Object.keys(cmd.expectedRevisions).filter(ref => ref.startsWith('guest:')).sort())
      !== canonicalJson(affected.map(guestId => `guest:${guestId}`).sort())) throw new CommandError('CONFLICT')
    for (const guestId of affected) expected(cmd, `guest:${guestId}`, entity(c.guests, guestId).revision)
    touch(room, () => { room.stayDates = selected })
    for (const guestId of affected) {
      const g = c.guests[guestId]
      if (g.additionalRoomStays || (room.reservedGuestIds && !room.reservedGuestIds.includes(g.id))) throw new CommandError('CONFLICT')
      touch(g, () => { g.roomId = key; g.stayNeed = 'needed'; g.stayDates = [...selected] })
    }
  })
  // Frozen older selections retain their original single-room semantics.
  add('room.assignGuests', (c, p, cmd) => {
    fields(p, ['id', 'guestIds', 'dates'], ['byNight'])
    if (p.byNight !== undefined && p.byNight !== true) invalid()
    const key = id(p.id), room = entity(c.rooms, key), selected = dates(p.dates)
    expected(cmd, `room:${key}`, room.revision); expected(cmd, 'config', c.config.revision)
    if (selected.some(date => !c.config.stayDates.includes(date)) || !Array.isArray(p.guestIds)) invalid()
    const ids = (p.guestIds as unknown[]).map(id)
    if (!ids.length || new Set(ids).size !== ids.length) invalid()
    if (canonicalJson(Object.keys(cmd.expectedRevisions).filter(ref => ref.startsWith('guest:')).sort())
      !== canonicalJson(ids.map(guestId => `guest:${guestId}`).sort())) throw new CommandError('CONFLICT')
    for (const guestId of ids) expected(cmd, `guest:${guestId}`, entity(c.guests, guestId).revision)
    for (const guestId of ids) {
      const g = c.guests[guestId]
      if (p.byNight) requireFreeRoomNights(g, room, selected)
      else if (g.additionalRoomStays || (room.reservedGuestIds && !room.reservedGuestIds.includes(guestId))) throw new CommandError('CONFLICT')
      touch(g, () => {
        g.stayNeed = 'needed'
        if (p.byNight) setDatesInRoom(g, key, [...selected])
        else writeGuestStays(g, [{ roomId: key, dates: [...selected] }])
      })
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
    if (g.additionalRoomStays) throw new CommandError('CONFLICT')
    if (roomId !== null) {
      const r = entity(c.rooms, roomId); expected(cmd, `room:${roomId}`, r.revision)
      if (r.reservedGuestIds && !r.reservedGuestIds.includes(g.id)) throw new CommandError('CONFLICT')
    }
    touch(g, () => { g.roomId = roomId; if (roomId) { g.stayNeed = 'needed'; if (c.rooms[roomId].stayDates) g.stayDates = [...c.rooms[roomId].stayDates!] } else g.stayDates = [] })
  })
  add('stayDate.add', (c, p, cmd) => {
    fields(p, ['date']); expected(cmd, 'config', c.config.revision)
    const [date] = dates([p.date])
    touch(c.config, () => { c.config.stayDates = [...new Set([...c.config.stayDates, date])].sort() })
  })
  add('guest.setStayDates', (c, p, cmd) => {
    fields(p, ['id', 'dates'], ['roomId']); const g = guest(c, p, cmd), selected = dates(p.dates)
    expected(cmd, 'config', c.config.revision)
    const key = p.roomId === undefined ? g.roomId : id(p.roomId)
    if ((!key && selected.length) || selected.some(d => !c.config.stayDates.includes(d))) invalid()
    if (p.roomId === undefined && g.additionalRoomStays) throw new CommandError('CONFLICT')
    if (!key) return
    if (!stayInRoom(g, key)) throw new CommandError('CONFLICT')
    const room = entity(c.rooms, key)
    if (p.roomId !== undefined) expected(cmd, `room:${key}`, room.revision)
    requireFreeRoomNights(g, room, selected)
    touch(g, () => { setDatesInRoom(g, key, selected) })
  })
  add('stayGift.update', (c, p, cmd) => {
    fields(p, ['enabled', 'date']); expected(cmd, 'config', c.config.revision)
    if (typeof p.enabled !== 'boolean') invalid()
    const date = p.date === null ? null : text(p.date, true)
    if (date !== null && (!p.enabled || !c.config.stayDates.includes(date))) invalid()
    touch(c.config, () => {
      if (p.enabled) c.config.twinGiftDate = date
      else delete c.config.twinGiftDate
    })
  })
  return handlers
}
