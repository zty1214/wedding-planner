import { assertRecycleRecord, restoreCore } from './recycle.ts'
import type { RecycleRecord } from './recycle.ts'
import { assertTextNote } from './notes.ts'
import { CommandError } from './protocol.ts'
import type { Command } from './protocol.ts'
import type { ProjectSnapshot } from './repository.ts'

/** A read-only arrangement preview; the transaction still validates expiry and conflicts on commit. */
export function projectRecycleDraft(snapshot: ProjectSnapshot, command: Command, record: RecycleRecord, now = new Date()): ProjectSnapshot {
  assertRecycleRecord(record)
  const p = command.payload
  if (command.type !== 'recycle.restore' || !p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1 || p.id !== record.id) throw new CommandError('INVALID_INPUT')
  if (command.dataEpoch !== snapshot.dataEpoch || record.dataEpoch !== snapshot.dataEpoch) throw new CommandError('PROJECT_REPLACED')
  if (record.restoredAt || Date.parse(record.expiresAt) <= now.getTime()) throw new CommandError('CONFLICT')
  const next = structuredClone(snapshot)
  if (record.type !== 'note.delete') restoreCore(next.data, record.changes, command)
  else {
    if (!next.notes || next.notesRevision === undefined) throw Error('NOTES_UNAVAILABLE')
    const change = record.changes[0]
    if (record.changes.length !== 1 || change.section !== 'notes') throw new CommandError('INVALID_INPUT')
    const note = structuredClone(change.before); assertTextNote(note)
    if (next.notes.some(n => n.id === note.id)) throw new CommandError('CONFLICT')
    note.revision++; note.updatedAt = now.toISOString(); assertTextNote(note)
    next.notes.splice(Math.min(change.position ?? next.notes.length, next.notes.length), 0, note)
    next.notesRevision++
  }
  return next
}
