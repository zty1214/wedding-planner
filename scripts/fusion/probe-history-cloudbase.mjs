import cloudbase from '@cloudbase/node-sdk'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { cloudApi, temporaryCredential } from './cloudbase-cli.mjs'
import { documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'

// Capability probe only: server-side fixed fixture, not a production history implementation.
const [env, output, flag] = process.argv.slice(2)
if (env !== 'dev-d1gh3jw1gdf06af22' || !output || flag !== '--isolated-probe') throw Error('Explicit isolated probe arguments required')
const collection = 'planner_fusion_probe_history'
const runId = `history-probe-${randomUUID()}`
const report = { observedAt: new Date().toISOString(), env, collection, runId, checks: [] }
let stage = 'prepare'
let secretValues = []
let transactionStep = ''
try {
  const tables = cloudApi('DescribeTables', { EnvId: env, MgoLimit: 100, MgoOffset: 0 })
  assert.ok(tables.Pager.Total <= 100)
  if (!tables.Tables.some(t => t.TableName === collection)) cloudApi('CreateTable', { EnvId: env, TableName: collection })
  cloudApi('ModifyDatabaseACL', { EnvId: env, CollectionName: collection, AclTag: 'ADMINONLY' })
  assert.equal(cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: collection }).AclTag, 'ADMINONLY')
  const credentials = temporaryCredential(env)
  secretValues = Object.values(credentials)
  const db = cloudbase.init({ env, region: 'ap-shanghai', ...credentials }).database()
  const key = (...parts) => documentKey(runId, ...parts)
  function checked(res) { if (res.code) { const error = new Error('DATABASE_FAILED'); error.code = res.code; throw error }; return res }
  const put = async (id, data) => checked(await db.collection(collection).doc(key(id)).set({ runId, ...data }))
  const get = async id => checked(await db.collection(collection).doc(key(id)).get()).data[0]
  const measure = async (name, fn) => { stage = name; const start = performance.now(); await fn(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }) }
  const guests = Array.from({ length: 150 }, (_, i) => ({ id: `fixture-guest-${i}`, name: `虚构宾客 ${i}`, group: '虚构分组', phone: '', notes: '', attendance: 'pending', stayNeed: 'pending', tableId: null, seatIndex: null, roomId: null, stayDates: [], revision: 0 }))
  const noteIds = Array.from({ length: 20 }, (_, i) => `note-${i}`)
  await put('current', { day: '2026-10-01', epoch: 'e1', revision: 0, guests, noteIds })
  for (const id of noteIds) await put(id, { id, epoch: 'e1', revision: 0, content: '虚构备婚笔记。'.repeat(30), images: [] })

  await measure('atomic_day_rollover_captures_prior_day_before_new_edit', async () => {
    await db.runTransaction(async tx => {
      const ref = id => tx.collection(collection).doc(key(id))
      transactionStep = 'read-core'
      const current = checked(await ref('current').get()).data
      transactionStep = 'read-notes'
      // This environment rejects parallel requests within one transaction (TransactionBusy).
      const notes = []
      for (const id of current.noteIds) notes.push(checked(await ref(id).get()).data)
      transactionStep = 'write-snapshot'
      checked(await ref('daily-2026-10-01').set({ runId, day: current.day, core: current, notes }))
      // Both the next day's first note edit and the core boundary commit together.
      const { _id: ignored, ...firstNote } = notes[0]
      void ignored
      transactionStep = 'write-note'
      checked(await ref(noteIds[0]).set({ ...firstNote, content: '次日修改', revision: 1 }))
      const { _id: ignoredCore, ...core } = current
      void ignoredCore
      transactionStep = 'write-core'
      checked(await ref('current').set({ ...core, day: '2026-10-02', revision: 1 }))
    })
    const snap = await get('daily-2026-10-01')
    assert.equal(snap.core.day, '2026-10-01'); assert.equal(snap.notes[0].revision, 0)
    assert.equal((await get(noteIds[0])).content, '次日修改')
    report.snapshotBytes = Buffer.byteLength(JSON.stringify(snap))
    report.fixture = { guests: guests.length, notes: noteIds.length, imageFiles: 0 }
  })
  await measure('failed_multi_document_restore_preserves_all_visible_data', async () => {
    await assert.rejects(db.runTransaction(async tx => {
      for (const id of ['current', ...noteIds]) {
        checked(await tx.collection(collection).doc(key(id)).set({ runId, epoch: 'BROKEN' }))
      }
      throw Error('INJECTED_BEFORE_COMMIT')
    }), /INJECTED_BEFORE_COMMIT/)
    assert.equal((await get('current')).epoch, 'e1')
    for (const id of noteIds) assert.equal((await get(id)).epoch, 'e1')
  })
  await measure('snapshot_restore_commits_core_and_twenty_notes_together', async () => {
    await db.runTransaction(async tx => {
      const ref = id => tx.collection(collection).doc(key(id))
      const snapshot = checked(await ref('daily-2026-10-01').get()).data
      const { _id, ...core } = snapshot.core
      void _id
      checked(await ref('current').set({ ...core, epoch: 'e2' }))
      for (const note of snapshot.notes) {
        const { _id: ignored, ...content } = note
        void ignored
        checked(await ref(note.id).set({ ...content, epoch: 'e2' }))
      }
    })
    assert.equal((await get('current')).epoch, 'e2')
    for (const id of noteIds) assert.equal((await get(id)).epoch, 'e2')
  })
  await measure('ninety_snapshot_storage_and_paged_metadata_read', async () => {
    const sample = await get('daily-2026-10-01')
    const { _id, ...snapshot } = sample
    void _id
    for (let start = 0; start < 90; start += 5) {
      await Promise.all(Array.from({ length: 5 }, (_, i) => put(`capacity-${start + i}`, { ...snapshot, kind: 'capacity', ordinal: start + i })))
    }
    const started = performance.now()
    const page = checked(await db.collection(collection).where({ runId, kind: 'capacity' }).field({ ordinal: true, day: true }).limit(20).get())
    assert.equal(page.data.length, 20)
    assert.ok(page.data.every(doc => !Object.hasOwn(doc, 'core') && !Object.hasOwn(doc, 'notes')))
    report.historyPageMs = Math.round(performance.now() - started)
    report.ninetySnapshotPayloadEstimateBytes = report.snapshotBytes * 90
  })
  report.status = 'PASS'
  report.limits = 'Fixture capability and local-server network timings only; no cron, authorization gateway, preview conflicts, images, retention cleanup, transaction-limit boundary, billing or real-user load verified.'
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage; report.transactionStep = transactionStep
  let message = String(error?.message ?? '')
  for (const secret of secretValues) message = message.replaceAll(secret, '[REDACTED]')
  report.diagnostic = message.slice(0, 400)
  report.errorCode = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code : 'PROBE_FAILED'
  process.exitCode = 1
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report))
