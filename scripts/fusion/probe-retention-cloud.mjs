// Admin SDK verification against one newly created disposable synthetic project only.
import cloudbase from '@cloudbase/node-sdk'
import assert from 'node:assert/strict'
import { open } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { temporaryCredential, cloudApi } from './cloudbase-cli.mjs'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { projectService } from '../../server/fusion/projectService.ts'
import { commandService } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { pruneExpired, runRetentionBatch, retentionScanRow } from '../../server/fusion/retention.ts'
import { activityService } from '../../server/fusion/activityService.ts'
const output = process.argv[2]
if (!output) throw Error('Provide a fresh report path')
const file = await open(output, 'wx', 0o600), env = 'dev-d1gh3jw1gdf06af22'
const report = { observedAt: new Date().toISOString(), env, mode: 'ADMIN_SDK_REAL_DATABASE_LOCAL_MAINTENANCE_CODE', checks: [] }
let stage = 'acl-readback'
try {
  for (const name of Object.values(PROBE_COLLECTIONS)) assert.equal(cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: name }).AclTag, 'ADMINONLY')
  const db = cloudbase.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }).database(), store = cloudBaseTransactionStore(db)
  stage = 'create-disposable-synthetic-project'
  const requestId = randomUUID(), secret = randomBytes(32).toString('hex')
  const { projectId } = await projectService(store).create({ requestId, title: '纯虚构到期清理验证', collaborationSecret: secret, managementSecret: randomBytes(32).toString('hex') })
  report.fixtureProjectId = projectId
  const command = { projectId, dataEpoch: requestId, operationId: randomUUID(), commandVersion: 1, type: 'guest.add', payload: { id: 'keep', name: '必须保留的虚构宾客', group: '' }, expectedRevisions: {} }
  await commandService(store, coreHandlers()).execute(command, secret)
  const now = new Date(), oldDate = new Date(+now - 91 * 86400000).toISOString(), expiredAt = new Date(+now - 86400000).toISOString()
  const current = await store.run(projectId, tx => tx.current())
  const version = { id: 'expired-daily', name: '纯虚构到期快照', kind: 'daily', status: 'ready', dataEpoch: requestId,
    snapshotRevision: current.snapshotRevision, notesRevision: 0, capturedAt: oldDate, lastBusinessCommittedAt: oldDate,
    businessDate: oldDate.slice(0, 10), expiresAt: expiredAt, counts: { guests: 1, tables: 0, rooms: 0, notes: 0 },
    schemaVersion: 1, core: current.data, notes: [], noteRetiredIds: [] }
  const manual = { ...version, id: 'keep-manual', name: '永久手动版本', kind: 'manual', expiresAt: null }
  const future = { ...version, id: 'keep-future', name: '未到期版本', capturedAt: now.toISOString(), expiresAt: new Date(+now + 90 * 86400000).toISOString() }
  const recycle = { id: 'expired-recycle', dataEpoch: requestId, type: 'guest.delete', createdAt: new Date(+now - 31 * 86400000).toISOString(), expiresAt: expiredAt, restoredAt: null, changes: [{ section: 'guests', id: 'gone', before: { ...current.data.guests.keep, id: 'gone', name: '已删除虚构宾客' }, after: null, position: 0 }] }
  stage = 'seed-disposable-expired-fixtures'
  await store.run(projectId, async tx => {
    for (const v of [version, manual, future]) await tx.putVersion(v)
    await tx.putHistoryIndex([version, manual, future].map(({ schemaVersion: _schema, core: _core, notes: _notes, noteRetiredIds: _ids, ...meta }) => meta))
    await tx.putRecycle(requestId, recycle); await tx.putRecycleIndex(requestId, [recycle.id])
  })
  const before = await store.run(projectId, async tx => ({ current: await tx.current(), access: await tx.access(), receipt: await tx.receipt(requestId, command.operationId), history: await tx.historyIndex() }))
  const check = async (name, fn) => { stage = name; const start = performance.now(); await fn(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }) }
  const candidate = (id, kind = 'version') => ({ projectId, id, kind, dataEpoch: requestId })
  await check('manual_future_wrong_epoch_protected', async () => {
    assert.equal(await pruneExpired(store, candidate(manual.id), now), 'protected')
    assert.equal(await pruneExpired(store, candidate(future.id), now), 'protected')
    assert.equal(await pruneExpired(store, { ...candidate(version.id), dataEpoch: 'wrong' }, now), 'protected')
  })
  await check('real_transaction_rolls_back_recycle_delete_when_index_write_fails', async () => {
    let injected = false
    const failing = { run: (id, body) => store.run(id, tx => body({ ...tx, putRecycleIndex: async () => { injected = true; throw Error('INJECTED_INDEX_FAILURE') } })) }
    await assert.rejects(pruneExpired(failing, candidate(recycle.id, 'recycle'), now))
    assert.equal(injected, true, 'DELETE_MUST_REACH_INDEX_FAILURE')
    assert.deepEqual(await store.run(projectId, tx => tx.recycle(requestId, recycle.id)), recycle)
    assert.deepEqual(await store.run(projectId, tx => tx.recycleIndex(requestId)), [recycle.id])
  })
  const collection = db.collection(PROBE_COLLECTIONS.current), cursor = collection.doc(documentKey(projectId, 'retention-probe-cursor'))
  const source = {
    async cursor() { const r = await cursor.get(); if (r.code) throw Error('CURSOR_READ'); return r.data[0]?.payload?.after ?? null },
    async list(after, limit) {
      const r = await collection.where({ projectId, 'payload.expiresAt': db.command.gt('').and(db.command.lte(now.toISOString())), ...(after ? { _id: db.command.gt(after) } : {}) })
        .field({ _id: true, projectId: true, 'payload.id': true, 'payload.dataEpoch': true, 'payload.kind': true, 'payload.type': true }).orderBy('_id', 'asc').limit(limit).get()
      if (r.code) throw Error('SCAN_FAILED')
      return r.data.map(retentionScanRow)
    },
    async checkpoint(after) { const r = await cursor.set({ projectId, payload: { after } }); if (r.code) throw Error('CURSOR_WRITE') },
  }
  await check('real_expiry_scan_bounded_batch_and_repeat_cleanup', async () => {
    const hints = await source.list(null, 20); assert.equal(hints.filter(r => r.candidate).length, 2); report.scanRows = hints.length; report.skippedIndexRows = hints.filter(r => !r.candidate).length
    assert.deepEqual(await runRetentionBatch(store, source, id => id === projectId, now), { removed: 2, skipped: 1, failed: 0, batchLimit: 20 })
    assert.deepEqual(await runRetentionBatch(store, source, id => id === projectId, now), { removed: 0, skipped: 1, failed: 0, batchLimit: 20 })
    assert.equal(await store.run(projectId, tx => tx.version(version.id)), null)
    assert.equal(await store.run(projectId, tx => tx.recycle(requestId, recycle.id)), null)
    assert.deepEqual(await store.run(projectId, tx => tx.recycleIndex(requestId)), [])
  })
  await check('calendar_metadata_current_access_receipts_and_manual_remain', async () => {
    const after = await store.run(projectId, async tx => ({ current: await tx.current(), access: await tx.access(), receipt: await tx.receipt(requestId, command.operationId), history: await tx.historyIndex() }))
    assert.deepEqual(after, before)
    assert.deepEqual(await store.run(projectId, tx => tx.version(manual.id)), manual)
    assert.deepEqual(await store.run(projectId, tx => tx.version(future.id)), future)
    const calendar = await activityService(store, () => now).month(projectId, secret, version.businessDate.slice(0, 7))
    assert.equal(calendar.days.find(d => d.activity.day === version.businessDate)?.snapshot, 'expired')
  })
  report.status = 'PASS'; report.scope = 'Expired records backdated in this new synthetic project only. No deployed maintenance function, global cursor, timer, ACL, client permissions or existing project changed.'
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage
  report.errorCode = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code : 'PROBE_FAILED'
  process.exitCode = 1
} finally { await file.writeFile(JSON.stringify(report, null, 2)); await file.close(); console.log(JSON.stringify(report)) }
