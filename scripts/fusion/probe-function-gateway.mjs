import clientSDK from '@cloudbase/js-sdk'
import serverSDK from '@cloudbase/node-sdk'
import { readFile, open } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { temporaryCredential, cloudApi, functionDetail } from './cloudbase-cli.mjs'
import { PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'

const [configPath, manifestPath, output, mode] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide public env config, deployment manifest and fresh report path')
const config = parseEnv(await readFile(configPath, 'utf8'))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const env = config.VITE_CLOUDBASE_ENV_ID
if (env !== 'dev-d1gh3jw1gdf06af22' || manifest.env !== env || manifest.functionName !== 'planner-fusion-gateway-probe'
  || manifest.projects?.length !== 2 || manifest.projects.some(id => !/^fusion-gateway-[a-f0-9-]{36}$/.test(id))) throw Error('INVALID_PROBE_MANIFEST')
// Reserve output before doing anything remote, including fixture writes.
const reportFile = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env, mode: mode === '--browser' ? 'REAL_BROWSER_TO_DEPLOYED_FUNCTION' : 'JS_SDK_NODE_CLIENT_TO_DEPLOYED_FUNCTION',
  functionName: manifest.functionName, bundleSha256: manifest.sha256, fixtureProjectIds: manifest.projects, checks: [] }
let stage = 'deployment-readback'
let relay
try {
  const deployed = functionDetail(env, manifest.functionName)
  const vars = Object.fromEntries(deployed.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(deployed.Status, 'Active')
  assert.equal(vars.FUSION_PROBE_ENV, env)
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
  stage = 'acl-readback'
  for (const name of Object.values(PROBE_COLLECTIONS)) assert.equal(cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: name }).AclTag, 'ADMINONLY')
  const db = serverSDK.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }).database()
  const [a, b] = manifest.projects
  const secrets = [0, 1].map(() => ({ collaboration: randomBytes(32).toString('hex'), management: randomBytes(32).toString('hex') }))
  async function put(collection, projectId, payload) {
    const r = await db.collection(collection).doc(documentKey(projectId)).set({ projectId, payload })
    if (r.code) throw Error('FIXTURE_WRITE_FAILED')
  }
  stage = 'seed'
  for (const [i, projectId] of manifest.projects.entries()) {
    // Refuse reusing an existing fixture; a new manifest requires matching function deployment.
    const existing = await db.collection(PROBE_COLLECTIONS.current).doc(documentKey(projectId)).get()
    assert.ok(!existing.code && existing.data.length === 0, 'FIXTURE_ALREADY_EXISTS')
    await put(PROBE_COLLECTIONS.access, projectId, { collaborationHash: hashSecret(secrets[i].collaboration), managementHash: hashSecret(secrets[i].management) })
    await put(PROBE_COLLECTIONS.current, projectId, { dataEpoch: 'epoch1', snapshotRevision: 0, data: 0 })
  }
  const clientConfig = { env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY }
  let app
  stage = 'anonymous-login'
  if (mode === '--browser') {
    const { browserProbeRelay } = await import('./browser-probe-relay.mjs')
    relay = await browserProbeRelay(clientConfig)
    await relay.ready()
  } else {
    app = clientSDK.init(clientConfig)
    assert.ok(!(await app.auth().signInAnonymously()).error)
  }
  report.anonymousLogin = 'PASS'
  async function call(data) {
    const r = relay ? await relay.call(data) : await app.callFunction({ name: manifest.functionName, data })
    if (r.code) throw Object.assign(Error('FUNCTION_TRANSPORT_FAILED'), { code: r.code })
    if (!r.result || typeof r.result.ok !== 'boolean') throw Error('INVALID_FUNCTION_RESPONSE')
    return r.result
  }
  const check = async (name, run) => { stage = name; const start = performance.now(); await run(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }) }
  const request = (action, extra = {}) => ({ action, projectId: a, secret: secrets[0].collaboration, ...extra })
  const command = { projectId: a, dataEpoch: 'epoch1', operationId: randomUUID(), commandVersion: 1, type: 'probe.increment', payload: null, expectedRevisions: {} }
  const denied = r => assert.deepEqual(r, { ok: false, error: { code: 'FORBIDDEN' } })
  await check('anonymous_client_reaches_function_with_valid_project_secret', async () => {
    assert.deepEqual(await call(request('read')), { ok: true, value: { dataEpoch: 'epoch1', snapshotRevision: 0, data: 0 } })
    assert.equal((await call(request('read', { projectId: b, secret: secrets[1].collaboration }))).ok, true)
  })
  await check('missing_wrong_cross_project_and_nested_project_denied', async () => {
    for (const extra of [{ secret: '' }, { secret: 'f'.repeat(64) }, { projectId: b }]) denied(await call(request('read', extra)))
    denied(await call(request('execute', { command: { ...command, projectId: b } })))
    denied(await call(request('receipt', { projectId: b, dataEpoch: 'epoch1', operationId: command.operationId })))
  })
  await check('management_command_requires_management_secret', async () => {
    const c = { ...command, operationId: randomUUID(), type: 'probe.manage' }
    denied(await call(request('execute', { command: c })))
    assert.equal((await call(request('execute', { secret: secrets[0].management, command: c }))).ok, true)
    denied(await call(request('execute', { secret: secrets[1].management, command: c })))
  })
  await check('discarded_response_receipt_query_and_concurrent_retries_commit_once', async () => {
    assert.equal((await call(request('execute', { command }))).ok, true) // Discard payload as a lost-response simulation.
    const receipt = await call(request('receipt', { dataEpoch: 'epoch1', operationId: command.operationId }))
    assert.equal(receipt.ok, true); assert.equal(receipt.value.snapshotRevision, 1)
    for (const result of await Promise.all([call(request('execute', { command })), call(request('execute', { command }))])) assert.deepEqual(result, receipt)
    assert.equal((await call(request('read'))).value.data, 1)
    assert.deepEqual(await call(request('execute', { command: { ...command, payload: 'changed' } })), { ok: false, error: { code: 'OPERATION_ID_REUSED' } })
  })
  await check('polling_and_receipt_reads_recheck_revoked_credentials', async () => {
    await put(PROBE_COLLECTIONS.access, a, { collaborationHash: hashSecret(randomBytes(32).toString('hex')), managementHash: hashSecret(secrets[0].management) })
    for (const action of ['read', 'execute', 'receipt']) denied(await call(request(action, { command, dataEpoch: 'epoch1', operationId: command.operationId })))
    assert.equal((await call(request('read', { secret: secrets[0].management }))).ok, true)
    assert.equal((await call(request('read', { projectId: b, secret: secrets[1].collaboration }))).value.data, 0)
  })
  report.status = 'PASS'
  report.scope = 'Bearer-secret transport only, no link/session exchange, real network timeout, files, or business UI. Polling authorization verified per request, not a subscription implementation. See mode for Node vs real browser.'
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage
  report.errorCode = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code : 'PROBE_FAILED'
  process.exitCode = 1
} finally {
  relay?.finish(report)
  await reportFile.writeFile(JSON.stringify(report, null, 2) + '\n'); await reportFile.close()
}
console.log(JSON.stringify(report))
