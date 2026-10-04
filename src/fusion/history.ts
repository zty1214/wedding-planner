import type { Core } from './core.ts'
import type { TextNote } from './notes.ts'
import { assertTextNote } from './notes.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
export type VersionMeta = {
  id: string; name: string; kind: 'manual' | 'daily' | 'safety'; status: 'ready'
  dataEpoch: string; snapshotRevision: number; notesRevision: number
  lastBusinessCommittedAt?: string
  capturedAt: string; businessDate: string; expiresAt: string | null
  counts: { guests: number; tables: number; rooms: number; notes: number }
}
export type ProjectVersion = VersionMeta & { schemaVersion: 1; core: Core; notes: TextNote[]; noteRetiredIds: string[] }
export type HistoryPage = { versions: VersionMeta[]; nextCursor: string | null }
export function assertVersionMeta(value: unknown): asserts value is VersionMeta {
  if (!value || typeof value !== 'object') throw Error('INVALID_VERSION')
  const v = value as VersionMeta
  if (typeof v.id !== 'string' || !v.id || typeof v.name !== 'string' || !v.name.trim()
    || !['manual', 'daily', 'safety'].includes(v.kind) || v.status !== 'ready'
    || typeof v.dataEpoch !== 'string' || !v.dataEpoch || !Number.isSafeInteger(v.snapshotRevision) || v.snapshotRevision < 0
    || !Number.isSafeInteger(v.notesRevision) || v.notesRevision < 0 || typeof v.capturedAt !== 'string' || !Number.isFinite(Date.parse(v.capturedAt))
    || typeof v.businessDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.businessDate)
    || (v.expiresAt !== null && (typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt))))
    || (v.kind === 'daily' && (typeof v.lastBusinessCommittedAt !== 'string' || !Number.isFinite(Date.parse(v.lastBusinessCommittedAt))))
    || (v.kind === 'manual' && v.expiresAt !== null) || !v.counts
    || ['guests', 'tables', 'rooms', 'notes'].some(k => !Number.isSafeInteger(v.counts[k as keyof typeof v.counts]) || v.counts[k as keyof typeof v.counts] < 0)) throw Error('INVALID_VERSION')
}
export function assertProjectVersion(value: unknown): asserts value is ProjectVersion {
  assertVersionMeta(value)
  const v = value as ProjectVersion
  if (v.schemaVersion !== 1 || !Array.isArray(v.notes) || !Array.isArray(v.noteRetiredIds) || v.noteRetiredIds.some(id => typeof id !== 'string')) throw Error('INVALID_VERSION')
  assertCore(v.core); v.notes.forEach(assertTextNote)
  if (new Set(v.notes.map(n => n.id)).size !== v.notes.length || v.counts.guests !== v.core.guestOrder.length
    || v.counts.tables !== v.core.tableOrder.length || v.counts.rooms !== v.core.roomOrder.length || v.counts.notes !== v.notes.length) throw Error('INVALID_VERSION')
}
