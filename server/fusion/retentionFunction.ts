import cloudbase from '@cloudbase/node-sdk'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS } from './cloudBaseTransactionStore.ts'
import { runRetentionBatch, retentionScanRow } from './retention.ts'

/** Internal maintenance entry; deploy only with client invocation explicitly denied. */
export async function main() {
  const env = process.env.FUSION_PROBE_ENV
  if (env !== 'dev-d1gh3jw1gdf06af22') return { ok: false, code: 'INVALID_ENV' }
  const allowed = new Set((process.env.FUSION_PROBE_PROJECTS ?? '').split(',').filter(Boolean))
  const now = new Date()
  try {
    const db = cloudbase.init({ env, region: 'ap-shanghai' }).database()
    const collection = db.collection(PROBE_COLLECTIONS.current)
    const cursor = collection.doc('planner_fusion_retention_scan_cursor_v1')
    const result = await runRetentionBatch(cloudBaseTransactionStore(db), {
      async cursor() {
        const result = await cursor.get()
        if ('code' in result && result.code) throw Error('RETENTION_CURSOR_READ_FAILED')
        const after = result.data[0]?.payload?.after
        if (after !== undefined && after !== null && typeof after !== 'string') throw Error('INVALID_RETENTION_CURSOR')
        return after ?? null
      },
      async list(after, limit) {
        const result = await collection.where({ 'payload.expiresAt': db.command.gt('').and(db.command.lte(now.toISOString())),
          ...(after === null ? {} : { _id: db.command.gt(after) }),
        }).field({ _id: true, projectId: true, 'payload.id': true, 'payload.dataEpoch': true, 'payload.kind': true, 'payload.type': true }).orderBy('_id', 'asc').limit(limit).get()
        if ('code' in result && result.code) throw Error('RETENTION_SCAN_FAILED')
        return result.data.map(retentionScanRow)
      },
      async checkpoint(after) {
        const result = await cursor.set({ projectId: 'planner-fusion-retention-worker', payload: { after } })
        if ('code' in result && result.code) throw Error('RETENTION_CURSOR_WRITE_FAILED')
      },
    }, id => allowed.has(id) || /^fusion-created-[a-f0-9-]{36}$/.test(id), now)
    return { ok: result.failed === 0, ...result }
  } catch { return { ok: false, code: 'RETENTION_BATCH_FAILED' } }
}
