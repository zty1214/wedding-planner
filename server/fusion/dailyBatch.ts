export interface DailyCandidate { _id: string; projectId?: unknown }
export interface DailyBatchSource {
  cursor(): Promise<string | null>
  list(after: string | null, limit: number): Promise<DailyCandidate[]>
  checkpoint(after: string | null): Promise<void>
  close(projectId: string): Promise<unknown>
}
/** A durable scan cursor advances even past failed projects; a later scan retries them. */
export async function runDailyBatch(source: DailyBatchSource, allowed: ReadonlySet<string>, limit = 20) {
  const after = await source.cursor()
  let rows = await source.list(after, limit)
  if (!rows.length && after !== null) rows = await source.list(null, limit)
  let completed = 0, failed = 0
  for (const doc of rows) {
    const id = doc.projectId
    if (typeof id !== 'string' || (!allowed.has(id) && !/^fusion-created-[a-f0-9-]{36}$/.test(id))) { failed++; continue }
    try { await source.close(id); completed++ } catch { failed++ }
  }
  await source.checkpoint(rows.at(-1)?._id ?? null)
  return { ok: failed === 0, completed, failed, batchLimit: limit }
}
