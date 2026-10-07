import { editTextNote } from './notes.ts'
import type { Core } from './core.ts'
import type { Command } from './protocol.ts'
import { CommandError } from './protocol.ts'
import { removeCore } from './removeCore.ts'
import { assertCore, coreHandlers } from '../../server/fusion/coreHandlers.ts'
import type { ProjectSnapshot } from './repository.ts'
const handlers = coreHandlers()
/** Shared projection for a live edit and an explicitly requested recovered export. */
export function projectDraft(snapshot: ProjectSnapshot, command: Command) {
  const { type } = command
  const handler = handlers.get(type)
  if (!handler && !['version.save', 'version.restore', 'note.add', 'note.update', 'stayDate.remove', 'note.delete', 'guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed', 'recycle.restore'].includes(type)) throw new CommandError('INVALID_INPUT')
  const next = handler ? handler.apply(snapshot.data, command) as Core : snapshot.data
  let nextSnapshot = { ...snapshot, data: next }
  if (type === 'note.add' || type === 'note.update') {
    const p = command.payload as { id: string }
    const old = snapshot.notes?.find(n => n.id === p.id)
    if (type === 'note.add' && old) throw new CommandError('CONFLICT')
    if (type === 'note.update' && !old) throw new CommandError('NOT_FOUND')
    if (old && command.expectedRevisions[`note:${old.id}`] !== old.revision) throw new CommandError('CONFLICT')
    const note = editTextNote(old, command.payload, new Date().toISOString())
    nextSnapshot = { ...nextSnapshot, notes: old ? snapshot.notes!.map(n => n.id === note.id ? note : n) : [note, ...(snapshot.notes ?? [])],
      notesRevision: (snapshot.notesRevision ?? 0) + Number(!old || note.revision !== old.revision) }
  }
  const coreRemoval = ['stayDate.remove', 'guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed'].includes(type)
  if (coreRemoval) {
    const data = structuredClone(snapshot.data)
    removeCore(data, command); assertCore(data)
    nextSnapshot = { ...nextSnapshot, data }
  }
  if (type === 'note.delete') {
    const p = command.payload
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1 || typeof p.id !== 'string') throw new CommandError('INVALID_INPUT')
    // An absent note list is not proof that there are no notes to preserve.
    if (!snapshot.notes || snapshot.notesRevision === undefined) throw new Error('NOTES_UNAVAILABLE')
    const old = snapshot.notes.find(note => note.id === p.id)
    if (!old) throw new CommandError('NOT_FOUND')
    if (command.expectedRevisions[`note:${old.id}`] !== old.revision) throw new CommandError('CONFLICT')
    nextSnapshot = { ...nextSnapshot, notes: snapshot.notes.filter(note => note.id !== p.id), notesRevision: snapshot.notesRevision + 1 }
  }
  const complete = !!handler || coreRemoval || ['note.add', 'note.update', 'note.delete', 'version.save'].includes(type)
  return { snapshot: nextSnapshot, complete }
}
