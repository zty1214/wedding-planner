// Real deployed gateway; fresh synthetic project. Local queues use separate fake-indexeddb factories.
import clientSDK from '@cloudbase/js-sdk'
import { IDBFactory } from 'fake-indexeddb'
import { readFile, open, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { functionDetail } from './cloudbase-cli.mjs'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
const [configPath, manifestPath, output] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide public config, deployment manifest, fresh report path')
const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.env !== 'dev-d1gh3jw1gdf06af22' || config.VITE_CLOUDBASE_ENV_ID !== manifest.env || manifest.functionName !== 'planner-fusion-gateway-probe') throw Error('INVALID_TARGET')
const file = await open(output, 'wx', 0o600); await file.close()
const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, deploymentManifestSha256: manifest.sha256, mode: 'REAL_GATEWAY_RECOVERY_EXPORT_WITH_LOCAL_FAULT_INJECTION', checks: [] }
const stores = [], repos = []
let stage = 'deployment-readback'
async function checkpoint() { await writeFile(output, JSON.stringify({ ...report, stage, status: report.status ?? 'RUNNING' }, null, 2), { mode: 0o600 }) }
async function bounded(work) {
  let timer
  try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SDK_REQUEST_TIMEOUT')), 30000) })]) }
  finally { clearTimeout(timer) }
}
async function mark(value) { stage = value; console.log(JSON.stringify({ stage })); await checkpoint() }

try {
  await mark(stage)
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  const app = clientSDK.init({ env: manifest.env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  await mark('anonymous-login'); assert.ok(!(await bounded(() => app.auth().signInAnonymously())).error)
  const call = async data => {
    report.inFlightAction = data.action; await checkpoint()
    const result = await bounded(() => app.callFunction({ name: manifest.functionName, data }))
    delete report.inFlightAction
    if (result.code || !result.result || typeof result.result.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
    return result.result
  }
  const secret = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex')
  await mark('create-synthetic-project')
  const result = await call({ action: 'project.create', request: { requestId: randomUUID(), title: '纯虚构恢复导出验收', collaborationSecret: secret, managementSecret: manager } })
  assert.equal(result.ok, true)
  const projectId = result.value.projectId; report.fixtureProjectId = projectId
  const a = gatewayTransport(projectId, secret, call), admin = gatewayTransport(projectId, manager, call)
  const epoch = (await a.read()).dataEpoch
  const command = (type, payload, expectedRevisions = {}, dataEpoch = epoch) => ({ projectId, dataEpoch, operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  const check = async (name, body) => { await mark(name); const started = performance.now(); await body(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) }) }
  const repository = async transport => {
    const storage = await openIndexedDbOutbox(new IDBFactory()); stores.push(storage)
    const repo = projectRepository(projectId, storage, transport, async (_key, body) => body()); repos.push(repo)
    await repo.open(); assert.equal(repo.getSnapshot().status, 'synced'); return repo
  }
  await mark('seed-business-data')
  await a.execute(command('table.add', { id: 't', label: '虚构桌', seats: 8, x: 10, y: 10 }))
  for (const id of ['g1', 'g2']) await a.execute(command('guest.add', { id, name: '虚构' + id, group: '' }))
  await check('recycle_restore_draft_export_is_read_only_and_matches_commit', async () => {
    const before = await admin.read()
    await admin.execute(command('guest.assign', { id: 'g1', tableId: 't', seatIndex: 0 }, { 'guest:g1': before.data.guests.g1.revision, 'table:t': before.data.tables.t.revision }))
    const seated = await admin.read()
    await admin.execute(command('table.deleteWithGuests', { id: 't' }, { 'table:t': seated.data.tables.t.revision, 'guest:g1': seated.data.guests.g1.revision }))
    const record = (await admin.readRecycle()).records[0]
    let offline = false
    const repo = await repository({ ...admin, queryReceipt: async c => { if (offline) throw Error('INJECTED_OFFLINE'); return admin.queryReceipt(c) } })
    offline = true
    await repo.dispatch('recycle.restore', { id: record.id }, { 'guest:g1': repo.getSnapshot().snapshot.data.guests.g1.revision })
    const pending = await repo.readDrafts(); assert.equal(pending.length, 1)
    offline = false
    const cloudBefore = await admin.read(), recycleBefore = await admin.readRecycle()
    const exported = await repo.captureRecoveredDraft()
    assert.equal(exported.snapshot.data.guests.g1.tableId, 't'); assert.equal(exported.snapshot.data.guests.g1.seatIndex, 0)
    assert.deepEqual(await admin.read(), cloudBefore); assert.deepEqual(await admin.readRecycle(), recycleBefore)
    assert.deepEqual(await repo.readDrafts(), pending); assert.equal(await admin.queryReceipt(pending[0].command), null)
    await repo.resume(); assert.equal(repo.getSnapshot().status, 'synced')
    assert.deepEqual((await admin.read()).data, exported.snapshot.data); repo.stop()
  })
  await check('whole_restore_export_before_commit_and_after_lost_response_is_read_only', async () => {
    await admin.execute(command('note.add', { id: 'n', title: '恢复目标笔记', category: '其他', content: '虚构目标正文' }))
    const before = await admin.read()
    await admin.execute(command('version.save', { name: '纯虚构导出恢复目标' }, { snapshot: before.snapshotRevision, notes: before.notesRevision }))
    const target = (await admin.readHistory()).versions.find(v => v.kind === 'manual'); assert.ok(target)
    await admin.execute(command('guest.update', { id: 'g1', patch: { name: '恢复之前新姓名' } }, { 'guest:g1': before.data.guests.g1.revision }))
    await admin.execute(command('note.update', { id: 'n', title: '后来笔记', category: '其他', content: '后来正文' }, { 'note:n': before.notes[0].revision }))
    let offline = false
    const repo = await repository({ ...admin, queryReceipt: async c => { if (offline) throw Error('INJECTED_OFFLINE'); return admin.queryReceipt(c) } })
    const base = repo.getSnapshot().snapshot; offline = true
    await repo.dispatch('version.restore', { id: target.id }, { snapshot: base.snapshotRevision, notes: base.notesRevision })
    const pending = await repo.readDrafts(); assert.equal(pending.length, 1); offline = false
    const cloudBefore = await admin.read(), historyBefore = await admin.readHistory()
    const exported = await repo.captureRecoveredDraft()
    assert.equal(exported.restoreTarget.id, target.id); assert.equal(exported.snapshot.data.guests.g1.name, before.data.guests.g1.name)
    assert.equal(exported.snapshot.notes[0].content, '虚构目标正文')
    assert.deepEqual(await admin.read(), cloudBefore); assert.deepEqual(await admin.readHistory(), historyBefore)
    assert.equal(await admin.queryReceipt(pending[0].command), null); assert.deepEqual(await repo.readDrafts(), pending)
    // Execute separately; intentionally leave the original client's durable request unresolved.
    const receipt = await admin.execute(pending[0].command)
    assert.notEqual(receipt.resultDataEpoch, epoch)
    const restored = await admin.read(), restoredHistory = await admin.readHistory()
    const resolvedExport = await repo.captureRecoveredDraft()
    assert.equal(resolvedExport.restoreTarget, undefined)
    assert.deepEqual(resolvedExport.snapshot.data, exported.snapshot.data)
    assert.deepEqual(resolvedExport.snapshot.notes, exported.snapshot.notes)
    assert.deepEqual(await admin.read(), restored); assert.deepEqual(await admin.readHistory(), restoredHistory)
    assert.deepEqual(await repo.readDrafts(), pending)
    await repo.resume(); assert.equal(repo.getSnapshot().status, 'synced'); assert.equal((await repo.readDrafts()).length, 0)
    assert.deepEqual(await admin.readHistory(), restoredHistory); repo.stop()
  })
  report.status = 'PASS'
  report.scope = 'Real CloudBase gateway/database; one anonymous SDK login with a private management credential. Read-only draft reconstruction is checked before and after actual restore. Local queue storage is fake-indexeddb. Offline and discarded-response faults are client-side injection, not an actual network outage. No independent browser/device claim; existing projects and permissions unchanged.'
} catch (error) { report.status = 'FAIL'; report.failedStage = stage; report.failureCode = ['SDK_REQUEST_TIMEOUT', 'CLOUDBASE_CLI_FAILED_CHECK_LOGIN_AND_NETWORK', 'CLOUDBASE_CLI_API_FAILED', 'TRANSPORT_FAILED'].includes(error.message) ? error.message : 'VALIDATION_FAILED'; process.exitCode = 1 }
finally { for (const repo of repos) repo.stop(); for (const storage of stores) storage.close(); await checkpoint(); console.log(JSON.stringify(report)) }
