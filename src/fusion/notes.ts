import { CommandError } from './protocol.ts'
export type TextNote = {
  id: string; revision: number; category: string; title: string; content: string
  createdAt: string; updatedAt: string
}
export type NoteIndex = { revision: number; order: string[]; retiredIds?: string[] }
export type NoteSnapshot = { dataEpoch: string; notesRevision: number; notes: TextNote[] }

export function assertTextNote(value: unknown): asserts value is TextNote {
  if (!value || typeof value !== 'object') throw new CommandError('INVALID_INPUT')
  const n = value as TextNote
  if (typeof n.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(n.id)
    || !Number.isSafeInteger(n.revision) || n.revision < 0
    || [n.category, n.title, n.content, n.createdAt, n.updatedAt].some(v => typeof v !== 'string')
    || !n.category.trim() || (!n.title.trim() && !n.content.trim())
    || !Number.isFinite(Date.parse(n.createdAt)) || !Number.isFinite(Date.parse(n.updatedAt))) throw new CommandError('INVALID_INPUT')
}

/** The same note projection is used before local persistence and inside the server transaction. */
export function editTextNote(old: TextNote | null | undefined, payload: unknown, timestamp: string): TextNote {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CommandError('INVALID_INPUT')
  const p = payload as Record<string, unknown>, fields = ['id', 'category', 'title', 'content']
  if (Object.keys(p).length !== fields.length || fields.some(k => typeof p[k] !== 'string')) throw new CommandError('INVALID_INPUT')
  const changed = !old || old.category !== p.category || old.title !== p.title || old.content !== p.content
  const note: TextNote = { id: p.id as string, category: p.category as string, title: p.title as string, content: p.content as string,
    revision: old ? old.revision + Number(changed) : 0, createdAt: old?.createdAt ?? timestamp, updatedAt: changed ? timestamp : old!.updatedAt }
  assertTextNote(note)
  return note
}
