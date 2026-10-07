import type { TransactionStore } from './commandService.ts'

export type RetentionCandidate = { projectId: string; id: string; kind: 'version' | 'recycle'; dataEpoch: string }
/** Internal maintenance only. Never exposed through the client gateway. */
export async function pruneExpired(store: TransactionStore, candidate: RetentionCandidate, now = new Date()) {
  const timestamp = now.getTime()
  if (!['version', 'recycle'].includes(candidate.kind) || !candidate.projectId || !candidate.id || !candidate.dataEpoch) throw Error('INVALID_RETENTION_CANDIDATE')
  const due = (expiry: string, created: string, days: number) => {
    const boundary = Math.max(Date.parse(expiry), Date.parse(created) + days * 86400000)
    return Number.isFinite(boundary) && timestamp >= boundary
  }
  if (!Number.isFinite(timestamp)) throw Error('INVALID_RETENTION_TIME')
  return store.run(candidate.projectId, async tx => {
    if (candidate.kind === 'version') {
      const version = await tx.version(candidate.id)
      if (!version) return 'missing'
      // Re-read inside the same serializable transaction as restoration. Candidates
      // are only scan hints; neither their expiry nor their kind authorizes deletion.
      if (version.dataEpoch !== candidate.dataEpoch || version.kind === 'manual' || !version.expiresAt) return 'protected'
      if (!due(version.expiresAt, version.capturedAt, 90)) return 'protected'
      await tx.removeVersion(version.id)
      // Keep small metadata so the calendar can distinguish expired from never made.
      return 'removed'
    }
    const record = await tx.recycle(candidate.dataEpoch, candidate.id)
    if (!record) return 'missing'
    if (!due(record.expiresAt, record.createdAt, 30)) return 'protected'
    const index = await tx.recycleIndex(candidate.dataEpoch)
    await tx.removeRecycle(candidate.dataEpoch, candidate.id)
    await tx.putRecycleIndex(candidate.dataEpoch, index.filter(id => id !== candidate.id))
    return 'removed'
  })
}

export interface RetentionSource {
  cursor(): Promise<string | null>
  list(after: string | null, limit: number): Promise<{ key: string; candidate: RetentionCandidate | null }[]>
  checkpoint(after: string | null): Promise<void>
}
export async function runRetentionBatch(store: TransactionStore, source: RetentionSource, allowed: (id: string) => boolean, now = new Date(), limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw Error('INVALID_RETENTION_LIMIT')
  const after = await source.cursor()
  let rows = await source.list(after, limit)
  if (!rows.length && after !== null) rows = await source.list(null, limit)
  if (rows.length > limit) throw Error('RETENTION_BATCH_OVERFLOW')
  let removed = 0, skipped = 0, failed = 0
  for (const row of rows) {
    if (!row.candidate || !allowed(row.candidate.projectId)) { skipped++; continue }
    try { if (await pruneExpired(store, row.candidate, now) === 'removed') removed++; else skipped++ }
    catch { failed++ }
  }
  // Advance past a failed candidate; the next scan cycle retries it without starving others.
  await source.checkpoint(rows.at(-1)?.key ?? null)
  return { removed, skipped, failed, batchLimit: limit }
}

/** Nested expiry queries can also match arrays inside history-index documents.
 * Keep every scanned key for cursor progress, but never treat an index as a body.
 */
export function retentionScanRow(row: { _id: string; projectId?: unknown; payload?: unknown }): { key: string; candidate: RetentionCandidate | null } {
  const skip = { key: row._id, candidate: null }
  const p = row.payload
  if (typeof row.projectId !== 'string' || !row.projectId || !p || typeof p !== 'object' || Array.isArray(p)) return skip
  const value = p as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id || typeof value.dataEpoch !== 'string' || !value.dataEpoch) return skip
  const version = ['daily', 'safety', 'manual'].includes(String(value.kind))
  const recycle = value.kind === undefined && ['guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed', 'note.delete', 'stayDate.remove'].includes(String(value.type))
  if (!version && !recycle) return skip
  return { key: row._id, candidate: { projectId: row.projectId, id: value.id, dataEpoch: value.dataEpoch, kind: version ? 'version' : 'recycle' } }
}
