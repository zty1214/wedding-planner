import serverSDK from '@cloudbase/node-sdk'
import { open, readFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { temporaryCredential, functionDetail, invokeFunction } from './cloudbase-cli.mjs'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { businessDay } from '../../server/fusion/businessTime.ts'
const [manifestPath, output, mode] = process.argv.slice(2)
if (mode !== undefined && mode !== '--invoke') throw Error('Unknown validation mode')
if (!manifestPath || !output) throw Error('Provide manifest and fresh report path')
const m = JSON.parse(await readFile(manifestPath, 'utf8'))
if (m.env !== 'dev-d1gh3jw1gdf06af22' || m.functionName !== 'planner-fusion-daily-probe') throw Error('INVALID_TARGET')
const file = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env: m.env, functionName: m.functionName, bundleSha256: m.sha256,
  mode: mode === '--invoke' ? 'ADMIN_INVOKED_WITH_SEEDED_PREVIOUS_DAY' : 'REAL_SCHEDULE_WITH_SEEDED_PREVIOUS_DAY_NO_MANUAL_INVOKE', checks: [] }
let stage = 'readback'
try {
  const detail = functionDetail(m.env, m.functionName)
  assert.equal(detail.Status, 'Active')
  report.triggers = detail.Triggers ?? []
  const db = serverSDK.init({ env: m.env, region: 'ap-shanghai', ...temporaryCredential(m.env) }).database()
  const store = cloudBaseTransactionStore(db), id = `fusion-created-${randomUUID()}`, secret = randomBytes(32).toString('hex')
  report.fixtureProjectId = id
  stage = 'seed'
  await store.run(id, async tx => {
    assert.equal(await tx.current(), null)
    await tx.putAccess({ collaborationHash: hashSecret(secret), managementHash: hashSecret(randomBytes(32).toString('hex')) })
    await tx.putCurrent({ dataEpoch: 'epoch1', snapshotRevision: 0, data: emptyCore() })
  })
  const yesterday = new Date(Date.now() - 86400000), now = () => yesterday
  const command = (type, payload) => ({ projectId: id, dataEpoch: 'epoch1', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions: {} })
  await commandService(store, coreHandlers(), now).execute(command('guest.add', { id: 'g', name: '定时任务虚构宾客', group: '测试' }), secret)
  await noteService(store, now).execute(command('note.add', { id: 'n', category: '测试', title: '定时快照测试', content: '浏览器关闭后仍应保存' }), secret)
  console.log(JSON.stringify({ stage: 'FIXTURE_READY', projectId: id }))
  stage = mode === '--invoke' ? 'admin-invoke' : 'await-real-timer'
  if (mode === '--invoke') invokeFunction(m.env, m.functionName)
  const deadline = Date.now() + 180000
  let version = null
  while (Date.now() < deadline) {
    version = await store.run(id, tx => tx.version(`daily:${businessDay(yesterday)}`))
    if (version) break
    await new Promise(resolve => setTimeout(resolve, 15000))
  }
  assert.ok(version, 'SCHEDULE_NOT_OBSERVED')
  assert.equal(version.core.guests.g.name, '定时任务虚构宾客')
  assert.equal(version.notes[0].content, '浏览器关闭后仍应保存')
  assert.equal(version.lastBusinessCommittedAt, yesterday.toISOString())
  assert.equal(Date.parse(version.expiresAt) - Date.parse(version.capturedAt), 90 * 86400000)
  assert.equal((await store.run(id, tx => tx.dailyState())).sealed, true)
  if (mode === '--invoke') {
    stage = 'cursor-readback-and-idempotency'
    const cursor = await db.collection(PROBE_COLLECTIONS.current).doc('planner_fusion_daily_scan_cursor_v1').get()
    assert.equal(cursor.data[0].payload.kind, 'daily-scan-cursor')
    const count = (await store.run(id, tx => tx.historyIndex())).length
    invokeFunction(m.env, m.functionName)
    assert.equal((await store.run(id, tx => tx.historyIndex())).length, count)
    report.checks.push({ name: 'persisted_scan_cursor_and_repeat_idempotency', passed: true })
  }
  report.capturedAt = version.capturedAt
  report.checks.push({ name: mode === '--invoke' ? 'admin_invoked_capture_core_notes_and_sealed_marker' : 'scheduled_capture_core_notes_and_sealed_marker', passed: true })
  report.status = 'PASS'
} catch { report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1 }
finally { await file.writeFile(JSON.stringify(report, null, 2)); await file.close(); console.log(JSON.stringify(report)) }
