import { canonicalJson, CommandError } from './protocol.ts'
import type { Command } from './protocol.ts'
import type { Core } from './core.ts'
import type { CoreChange } from './recycle.ts'

function expected(c: Command, key: string, revision: number) {
  if (c.expectedRevisions[key] !== revision) throw new CommandError('CONFLICT')
}
/** Mutates a private copy; shared by local drafts and atomic recycle writes. */
export function removeCore(core: Core, c: Command): CoreChange[] {
  const payload = c.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || typeof payload[c.type === 'stayDate.remove' ? 'date' : 'id'] !== 'string') throw new CommandError('INVALID_INPUT')
  const id = payload[c.type === 'stayDate.remove' ? 'date' : 'id'] as string
  const changes: CoreChange[] = []
  const recordGuest = (guestId: string, change: () => void) => {
    const before = structuredClone(core.guests[guestId]); expected(c, `guest:${guestId}`, before.revision)
    change(); core.guests[guestId].revision++
    changes.push({ section: 'guests', id: guestId, before, after: structuredClone(core.guests[guestId]) })
  }
  if (c.type === 'stayDate.remove') {
    if (!core.config.stayDates.includes(id)) throw new CommandError('NOT_FOUND')
    expected(c, 'config', core.config.revision)
    const affected = Object.values(core.guests).filter(g => g.stayDates.includes(id))
    if (canonicalJson(Object.keys(c.expectedRevisions).filter(k => k.startsWith('guest:')).sort()) !== canonicalJson(affected.map(g => `guest:${g.id}`).sort())) throw new CommandError('CONFLICT')
    const before = structuredClone(core.config)
    core.config.stayDates = core.config.stayDates.filter(date => date !== id); core.config.revision++
    changes.push({ section: 'config', id: 'stayDates', before, after: structuredClone(core.config) })
    for (const g of affected) recordGuest(g.id, () => { g.stayDates = g.stayDates.filter(date => date !== id) })
  } else if (c.type === 'guest.delete' || c.type === 'table.deleteWithGuests' || c.type === 'room.deleteWithAssignments') {
    const section = c.type === 'guest.delete' ? 'guests' : c.type === 'table.deleteWithGuests' ? 'tables' : 'rooms'
    const entities = core[section], entity = entities[id]
    if (!Object.hasOwn(entities, id)) throw new CommandError('NOT_FOUND')
    expected(c, `${section.slice(0, -1)}:${id}`, entity.revision)
    const affected = Object.values(core.guests).filter(g => section === 'tables' ? g.tableId === id : section === 'rooms' ? g.roomId === id : false)
    const expectedGuests = Object.keys(c.expectedRevisions).filter(key => key.startsWith('guest:')).sort()
    const actualGuests = (section === 'guests' ? [id] : affected.map(g => g.id)).map(id => `guest:${id}`).sort()
    if (canonicalJson(actualGuests) !== canonicalJson(expectedGuests)) throw new CommandError('CONFLICT')
    for (const g of affected) recordGuest(g.id, () => {
      if (section === 'tables') { g.tableId = null; g.seatIndex = null }
      else { g.roomId = null; g.stayDates = [] }
    })
    const orderKey = section === 'guests' ? 'guestOrder' : section === 'tables' ? 'tableOrder' : 'roomOrder'
    changes.push({ section, id, before: structuredClone(entity), after: null, position: core[orderKey].indexOf(id) })
    delete entities[id]; core[orderKey] = core[orderKey].filter(value => value !== id)
    core.retiredIds = [...new Set([...(core.retiredIds ?? []), `${section}:${id}`])]
  } else if (c.type === 'guest.clearRoom' || c.type === 'guest.clearStayNeed') {
    const g = core.guests[id]
    if (!Object.hasOwn(core.guests, id)) throw new CommandError('NOT_FOUND')
    if (!g.roomId) throw new CommandError('INVALID_INPUT')
    recordGuest(id, () => { g.roomId = null; g.stayDates = []; if (c.type === 'guest.clearStayNeed') g.stayNeed = 'not_needed' })
  } else throw new CommandError('INVALID_INPUT')
  return changes
}
