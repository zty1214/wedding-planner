// Real deployed gateway; fresh synthetic project. Local queues use separate fake-indexeddb factories.
import clientSDK from '@cloudbase/js-sdk'
import { IDBFactory } from 'fake-indexeddb'
import { readFile, open } from 'node:fs/promises'
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
const file = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, deploymentManifestSha256: manifest.sha256, mode: 'REAL_GATEWAY_CONCURRENT_REQUESTS_WITH_LOCAL_FAULT_INJECTION', checks: [] }
const stores = [], repos = []
let stage = 'deployment-readback'
try {
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  const app = clientSDK.init({ env: manifest.env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  stage = 'anonymous-login'; assert.ok(!(await app.auth().signInAnonymously()).error)
  const call = async data => {
    const result = await app.callFunction({ name: manifest.functionName, data })
    if (result.code || !result.result || typeof result.result.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
    return result.result
  }
  const secret = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex')
  stage = 'create-synthetic-project'
  const result = await call({ action: 'project.create', request: { requestId: randomUUID(), title: '纯虚构并发及草稿恢复验收', collaborationSecret: secret, managementSecret: manager } })
  assert.equal(result.ok, true)
  const projectId = result.value.projectId; report.fixtureProjectId = projectId
  const a = gatewayTransport(projectId, secret, call), b = gatewayTransport(projectId, secret, call), admin = gatewayTransport(projectId, manager, call)
  const epoch = (await a.read()).dataEpoch
  const command = (type, payload, expectedRevisions = {}, dataEpoch = epoch) => ({ projectId, dataEpoch, operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  const check = async (name, body) => { stage = name; const started = performance.now(); await body(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) }) }
  const repository = async transport => {
    const storage = await openIndexedDbOutbox(new IDBFactory()); stores.push(storage)
    const repo = projectRepository(projectId, storage, transport, async (_key, body) => body()); repos.push(repo)
    await repo.open(); assert.equal(repo.getSnapshot().status, 'synced'); return repo
  }
  stage = 'seed-business-data'
  await a.execute(command('table.add', { id: 't', label: '虚构桌', seats: 8, x: 10, y: 10 }))
  for (const id of ['g1', 'g2']) await a.execute(command('guest.add', { id, name: '虚构' + id, group: '' }))
  await check('same_seat_concurrent_claim_has_one_winner_and_one_conflict', async () => {
    const requests = ['g1', 'g2'].map(id => command('guest.assign', { id, tableId: 't', seatIndex: 0 }, { ['guest:' + id]: 0, 'table:t': 0 }))
    const results = await Promise.allSettled([a.execute(requests[0]), b.execute(requests[1])])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const loser = results.find(r => r.status === 'rejected'); assert.equal(loser.reason.code, 'SEAT_OCCUPIED')
    const current = await a.read(); const seated = Object.values(current.data.guests).filter(g => g.tableId === 't' && g.seatIndex === 0)
    assert.equal(seated.length, 1)
    for (let i = 0; i < requests.length; i++) assert.equal(!!await a.queryReceipt(requests[i]), results[i].status === 'fulfilled')
  })
  await check('different_guests_concurrent_edits_both_survive', async () => {
    const before = await a.read()
    const requests = ['g1', 'g2'].map((id, index) => command('guest.update', { id, patch: { phone: '001230' + index } }, { ['guest:' + id]: before.data.guests[id].revision }))
    await Promise.all([a.execute(requests[0]), b.execute(requests[1])])
    const current = await b.read()
    assert.equal(current.data.guests.g1.phone, '0012300'); assert.equal(current.data.guests.g2.phone, '0012301')
    assert.equal(current.snapshotRevision, before.snapshotRevision + 2)
  })
  await check('real_conflict_retained_then_new_intent_submitted_without_replaying_original', async () => {
    const repo = await repository(a), before = repo.getSnapshot().snapshot
    await b.execute(command('guest.update', { id: 'g1', patch: { name: '另一端最新姓名' } }, { 'guest:g1': before.data.guests.g1.revision }))
    assert.equal(await repo.dispatch('guest.update', { id: 'g1', patch: { name: '原冲突草稿' } }, { 'guest:g1': before.data.guests.g1.revision }), true)
    assert.equal(repo.getSnapshot().status, 'conflict')
    const frozen = await repo.readDrafts(); assert.equal(frozen.length, 1)
    assert.equal((await repo.readDraftCurrent()).data.guests.g1.name, '另一端最新姓名')
    await repo.discardDrafts(frozen, true)
    assert.deepEqual((await repo.readDraftArchives())[0].drafts, frozen)
    const fresh = repo.getSnapshot().snapshot
    assert.equal(await repo.dispatch('guest.update', { id: 'g1', patch: { name: '人工核对后的新姓名' } }, { 'guest:g1': fresh.data.guests.g1.revision }), true)
    assert.equal(repo.getSnapshot().status, 'synced')
    assert.equal((await a.read()).data.guests.g1.name, '人工核对后的新姓名')
    assert.equal(await a.queryReceipt(frozen[0].command), null)
    repo.stop()
  })
  await check('discarded_success_response_is_confirmed_once_by_original_receipt', async () => {
    let executions = 0
    const repo = await repository({ ...a, execute: async c => { executions++; await a.execute(c); throw Error('INJECTED_LOST_RESPONSE') } })
    const before = repo.getSnapshot().snapshot
    await repo.dispatch('guest.update', { id: 'g2', patch: { notes: '丢响应恢复验证' } }, { 'guest:g2': before.data.guests.g2.revision })
    assert.equal(repo.getSnapshot().status, 'unknown')
    const frozen = await repo.readDrafts(); assert.equal(frozen.length, 1)
    await repo.resume(); assert.equal(repo.getSnapshot().status, 'synced'); assert.equal(executions, 1)
    assert.equal((await a.read()).data.guests.g2.revision, before.data.guests.g2.revision + 1)
    assert.ok(await a.queryReceipt(frozen[0].command)); repo.stop()
  })
  await check('project_restore_blocks_old_epoch_queue_and_retains_original_intent', async () => {
    const before = await admin.read()
    await admin.execute(command('version.save', { name: '纯虚构恢复基线' }, { snapshot: before.snapshotRevision, notes: before.notesRevision }))
    const history = await admin.readHistory(); const target = history.versions.find(v => v.kind === 'manual'); assert.ok(target)
    let offline = false, executions = 0
    const repo = await repository({ ...a, queryReceipt: async c => { if (offline) throw Error('INJECTED_OFFLINE'); return a.queryReceipt(c) }, execute: async c => { executions++; return a.execute(c) } })
    offline = true
    await repo.dispatch('guest.update', { id: 'g1', patch: { name: '恢复前未发送草稿' } }, { 'guest:g1': before.data.guests.g1.revision })
    const frozen = await repo.readDrafts(); assert.equal(frozen.length, 1)
    const current = await admin.read()
    const restored = await admin.execute(command('version.restore', { id: target.id }, { snapshot: current.snapshotRevision, notes: current.notesRevision }))
    assert.notEqual(restored.resultDataEpoch, epoch)
    offline = false; await repo.resume()
    assert.equal(repo.getSnapshot().status, 'conflict'); assert.equal(repo.getSnapshot().error, 'PROJECT_REPLACED')
    assert.deepEqual((await repo.readDrafts()).map(d => d.command), frozen.map(d => d.command)); assert.equal(executions, 0)
    assert.notEqual((await a.read()).data.guests.g1.name, '恢复前未发送草稿')
    await repo.discardDrafts(await repo.readDrafts(), true)
    assert.deepEqual((await repo.readDraftArchives())[0].drafts.map(d => d.command), frozen.map(d => d.command))
    assert.equal(repo.getSnapshot().status, 'synced'); repo.stop()
  })
  report.status = 'PASS'
  report.scope = 'Real CloudBase gateway/database; two concurrent request streams use one anonymous SDK login. Local queue storage is fake-indexeddb. Offline and discarded-response faults are client-side injection, not an actual network outage. No independent browser/device claim; existing projects and permissions unchanged.'
} catch { report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1 }
finally { for (const repo of repos) repo.stop(); for (const storage of stores) storage.close(); await file.writeFile(JSON.stringify(report, null, 2)); await file.close(); console.log(JSON.stringify(report)) }
