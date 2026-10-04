import cloudbase from '@cloudbase/node-sdk'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { cloudApi, temporaryCredential } from './cloudbase-cli.mjs'
import { cloudBaseTransactionStore, PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { CommandError } from '../../src/fusion/protocol.ts'

const [env, output, setup] = process.argv.slice(2)
if (env !== 'dev-d1gh3jw1gdf06af22' || !output || setup !== '--isolated-probe') throw Error('Usage: node --experimental-strip-types scripts/fusion/probe-cloudbase.mjs dev-d1gh3jw1gdf06af22 <report.json> --isolated-probe')
const report = { observedAt: new Date().toISOString(), env, mode: 'LOCAL_SERVER_SDK_TO_LIVE_CLOUDBASE', checks: [], collections: Object.values(PROBE_COLLECTIONS) }
let stage = 'inventory'
try {
  const tables = cloudApi('DescribeTables', { EnvId: env, MgoLimit: 100, MgoOffset: 0 })
  assert.ok(tables.Pager.Total <= 100)
  const existing = new Set(tables.Tables.map(t => t.TableName))
  for (const name of Object.values(PROBE_COLLECTIONS)) {
    stage = `prepare:${name}`
    if (!existing.has(name)) cloudApi('CreateTable', { EnvId: env, TableName: name })
    cloudApi('ModifyDatabaseACL', { EnvId: env, CollectionName: name, AclTag: 'ADMINONLY' })
  }
  stage = 'credentials'
  const db = cloudbase.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }).database()
  const store = cloudBaseTransactionStore(db)
  const pid = `fusion-probe-${randomUUID()}`
  const otherPid = `fusion-probe-${randomUUID()}`
  const collab = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex')
  const other = randomBytes(32).toString('hex')
  const commands = new Map([
    ['probe.increment', { apply: data => ({ ...data, counter: data.counter + 1 }) }],
    ['probe.manage', { managementOnly: true, apply: data => data }],
    ['probe.claim', { apply: (data, c) => { if (data.owner) throw new CommandError('CONFLICT'); return { ...data, owner: c.operationId } } }],
  ])
  async function put(collection, id, payload) {
    const result = await db.collection(collection).doc(documentKey(id)).set({ projectId: id, payload })
    if (result.code) throw Error('FIXTURE_WRITE_FAILED')
  }
  stage = 'seed'
  for (const [id, secret] of [[pid, collab], [otherPid, other]]) {
    await put(PROBE_COLLECTIONS.access, id, { collaborationHash: hashSecret(secret), managementHash: hashSecret(manager) })
    await put(PROBE_COLLECTIONS.current, id, { dataEpoch: 'epoch1', snapshotRevision: 0, data: { counter: 0, owner: null } })
  }
  const service = commandService(store, commands)
  const command = (id = randomUUID(), type = 'probe.increment') => ({ projectId: pid, dataEpoch: 'epoch1', operationId: id, commandVersion: 1, type, payload: null, expectedRevisions: {} })
  const check = async (name, fn) => { stage = name; const start = performance.now(); await fn(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }) }
  const read = () => store.run(pid, tx => tx.current())
  await check('concurrent_duplicate_commits_once', async () => {
    const c = command()
    const results = await Promise.all([service.execute(c, collab), service.execute(c, collab)])
    assert.deepEqual(results[0], results[1]); assert.equal((await read()).data.counter, 1)
    assert.deepEqual(await service.queryReceipt(pid, 'epoch1', c.operationId, collab), results[0])
    await assert.rejects(service.execute({ ...c, payload: 'changed' }, collab), { code: 'OPERATION_ID_REUSED' })
  })
  await check('project_and_management_permissions', async () => {
    await assert.rejects(service.execute({ ...command(), projectId: otherPid }, collab), { code: 'FORBIDDEN' })
    await assert.rejects(service.execute(command(undefined, 'probe.manage'), collab), { code: 'FORBIDDEN' })
    await assert.rejects(service.execute(command(), 'wrong-secret'), { code: 'FORBIDDEN' })
    await service.execute(command(undefined, 'probe.manage'), manager)
  })
  await check('receipt_failure_rolls_back_business_write', async () => {
    const before = await read(), c = command()
    const failing = commandService({ run: (id, body) => store.run(id, tx => body({ ...tx, putReceipt: async () => { throw Error('INJECTED_RECEIPT_FAILURE') } })) }, commands)
    await assert.rejects(failing.execute(c, collab), /INJECTED_RECEIPT_FAILURE/)
    assert.deepEqual(await read(), before)
    assert.equal(await service.queryReceipt(pid, 'epoch1', c.operationId, collab), null)
  })
  await check('competing_fixture_seat_has_one_winner', async () => {
    const results = await Promise.allSettled([service.execute(command(undefined, 'probe.claim'), collab), service.execute(command(undefined, 'probe.claim'), collab)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const rejected = results.find(r => r.status === 'rejected')
    assert.equal(rejected.reason.code, 'CONFLICT')
  })
  await check('revocation_applies_to_receipt_reads', async () => {
    const c = command(); await service.execute(c, collab)
    await put(PROBE_COLLECTIONS.access, pid, { collaborationHash: hashSecret(randomBytes(32).toString('hex')), managementHash: hashSecret(manager) })
    await assert.rejects(service.queryReceipt(pid, 'epoch1', c.operationId, collab), { code: 'FORBIDDEN' })
    const current = await read()
    await put(PROBE_COLLECTIONS.current, pid, { ...current, dataEpoch: 'epoch2' })
    assert.ok(await service.queryReceipt(pid, 'epoch1', c.operationId, manager))
    await assert.rejects(service.execute(c, manager), { code: 'PROJECT_REPLACED' })
  })
  report.status = 'PASS'; report.fixtureProjectIds = [pid, otherPid]
  report.scope = 'Admin SDK and application authorization only. Anonymous client rules, cloud function gateway, images and daily snapshots NOT VERIFIED.'
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage
  // No raw error message/stack: SDK errors may include credential-bearing request details.
  report.errorCode = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code : 'PROBE_FAILED'
  process.exitCode = 1
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report))
