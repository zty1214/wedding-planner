import cloudbase from '@cloudbase/node-sdk'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS } from './cloudBaseTransactionStore.ts'
import { closeDailyProject } from './dailySnapshots.ts'
import { runDailyBatch } from './dailyBatch.ts'
import { businessDay } from './businessTime.ts'

/** Scheduled function. Ignores client arguments; explicit client-deny rule remains a deployment gate. */
export async function main() {
  const env = process.env.FUSION_PROBE_ENV
  if (env !== 'dev-d1gh3jw1gdf06af22') return { ok: false, code: 'INVALID_ENV' }
  const allowed = new Set((process.env.FUSION_PROBE_PROJECTS ?? '').split(','))
  try {
    const db = cloudbase.init({ env, region: 'ap-shanghai' }).database()
    const collection = db.collection(PROBE_COLLECTIONS.current)
    const cursorDoc = collection.doc('planner_fusion_daily_scan_cursor_v1')
    const store = cloudBaseTransactionStore(db)
    const today = businessDay(new Date())
    return await runDailyBatch({
      async cursor() {
        const result = await cursorDoc.get()
        if ('code' in result && result.code) throw Error('DAILY_CURSOR_READ_FAILED')
        const value = result.data[0]?.payload?.after
        if (value !== undefined && value !== null && typeof value !== 'string') throw Error('INVALID_DAILY_CURSOR')
        return value ?? null
      },
      async list(after, limit) {
        const result = await collection.where({
          'payload.kind': 'daily-state', 'payload.sealed': false, 'payload.businessDate': db.command.lt(today),
          ...(after === null ? {} : { _id: db.command.gt(after) }),
        }).orderBy('_id', 'asc').limit(limit).get()
        if ('code' in result && result.code) throw Error('DAILY_QUERY_FAILED')
        return result.data as { _id: string; projectId?: unknown }[]
      },
      async checkpoint(after) {
        const result = await cursorDoc.set({ projectId: 'planner-fusion-daily-worker', payload: { kind: 'daily-scan-cursor', after } })
        if ('code' in result && result.code) throw Error('DAILY_CURSOR_WRITE_FAILED')
      },
      close: id => closeDailyProject(store, id),
    }, allowed)
  } catch { return { ok: false, code: 'DAILY_BATCH_FAILED' } }
}
