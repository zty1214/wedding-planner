import { canonicalJson, CommandError } from './protocol.ts'
import type { Json, Command } from './protocol.ts'
import { assertTextNote } from './notes.ts'
import type { TextNote } from './notes.ts'
import type { Core } from './core.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
export type CoreChange = { section: 'guests' | 'tables' | 'rooms' | 'config' | 'notes'; id: string; before: Json; after: Json; position?: number }
export type RecycleRecord = { id: string; dataEpoch: string; type: string; createdAt: string; expiresAt: string; restoredAt: string | null; changes: CoreChange[] }

export function restoreCore(core: Core, changes: CoreChange[], c: Pick<Command, 'expectedRevisions'>) {
  for (const change of changes) {
    if (change.section === 'config') {
      if (change.id !== 'stayDates' || canonicalJson(core.config) !== canonicalJson(change.after) || c.expectedRevisions.config !== core.config.revision) throw new CommandError('CONFLICT')
      const restored = structuredClone(change.before) as Core['config']
      restored.revision = core.config.revision + 1
      core.config = restored
      continue
    }
    if (change.section === 'notes') throw new CommandError('INVALID_INPUT')
    const entities = core[change.section] as Record<string, Json>
    const actual = Object.hasOwn(entities, change.id) ? entities[change.id] : null
    if (canonicalJson(actual) !== canonicalJson(change.after)) throw new CommandError('CONFLICT')
    if (actual && c.expectedRevisions[`${change.section.slice(0, -1)}:${change.id}`] !== (actual as { revision: number }).revision) throw new CommandError('CONFLICT')
    const old = structuredClone(change.before) as { revision: number }
    old.revision = Math.max(old.revision, (actual as { revision?: number } | null)?.revision ?? -1) + 1
    if (change.section === 'rooms' && change.after === null && Object.values(core.rooms).some(room => room.label.trim() === (old as unknown as Core['rooms'][string]).label.trim())) throw new CommandError('CONFLICT')
    entities[change.id] = old as unknown as Json
    if (change.after === null) {
      const key = change.section === 'guests' ? 'guestOrder' : change.section === 'tables' ? 'tableOrder' : 'roomOrder'
      core[key].splice(Math.min(change.position ?? core[key].length, core[key].length), 0, change.id)
    }
  }
  // Reject occupied seats, removed rooms or dates rather than overwriting someone else's work.
  try { assertCore(core) } catch { throw new CommandError('CONFLICT') }
}

export type RecycleList = { dataEpoch: string; records: RecycleRecord[] }
export function assertRecycleRecord(value: unknown): asserts value is RecycleRecord {
  const fail = (): never => { throw Error('INVALID_RECYCLE_RECORD') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const r = value as RecycleRecord
  if (typeof r.id !== 'string' || !r.id || typeof r.dataEpoch !== 'string' || !r.dataEpoch
    || !['guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed', 'note.delete', 'stayDate.remove'].includes(r.type)
    || !Number.isFinite(Date.parse(r.createdAt)) || !Number.isFinite(Date.parse(r.expiresAt))
    || Date.parse(r.expiresAt) <= Date.parse(r.createdAt)
    || (r.restoredAt !== null && !Number.isFinite(Date.parse(r.restoredAt)))
    || !Array.isArray(r.changes) || !r.changes.length) fail()
  const seen = new Set<string>()
  for (const c of r.changes) {
    if (!c || !['guests', 'tables', 'rooms', 'notes', 'config'].includes(c.section) || typeof c.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(c.id) || ['constructor', 'prototype', '__proto__'].includes(c.id)) fail()
    if (c.section === 'config' && (c.id !== 'stayDates' || r.type !== 'stayDate.remove')) fail()
    if (c.section === 'notes') { assertTextNote(c.before); if (c.after !== null || r.type !== 'note.delete') fail() }
    const key = c.section + ':' + c.id
    if (seen.has(key)) fail()
    seen.add(key)
    for (const entity of [c.before, c.after]) {
      if (entity === null && entity === c.after) continue
      if (!entity || typeof entity !== 'object' || Array.isArray(entity) || (c.section !== 'config' && entity.id !== c.id)
        || !Number.isSafeInteger(entity.revision) || Number(entity.revision) < 0) fail()
    }
    if (c.before === null || (c.position !== undefined && (!Number.isSafeInteger(c.position) || c.position < 0))) fail()
  }
  canonicalJson(r)
}

/** Uses the same pure restoration checks as the transaction; the server checks again on commit. */
export function previewRestore(core: Core, record: RecycleRecord, notes: TextNote[] = []) {
  if (record.type === 'note.delete') {
    if (record.changes.length !== 1 || record.changes[0].section !== 'notes' || notes.some(n => n.id === record.changes[0].id)) throw new CommandError('CONFLICT')
    return {}
  }
  const expectedRevisions: Record<string, number> = {}
  for (const c of record.changes) {
    if (c.section === 'config') { expectedRevisions.config = core.config.revision; continue }
    if (c.section === 'notes') throw new CommandError('INVALID_INPUT')
    const actual = core[c.section][c.id]
    if (actual) expectedRevisions[`${c.section.slice(0, -1)}:${c.id}`] = actual.revision
  }
  restoreCore(structuredClone(core), record.changes, { expectedRevisions })
  return expectedRevisions
}
