// One fresh synthetic project only. No real project or permission configuration changes.
import clientSDK from '@cloudbase/js-sdk'
import { readFile, open } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { functionDetail } from './cloudbase-cli.mjs'
const [configPath, manifestPath, output] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide config, manifest and fresh report path')
const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.env !== 'dev-d1gh3jw1gdf06af22' || config.VITE_CLOUDBASE_ENV_ID !== manifest.env || manifest.functionName !== 'planner-fusion-gateway-probe') throw Error('INVALID_TARGET')
const file = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, bundleSha256: manifest.sha256,
  mode: 'JS_SDK_NODE_CLIENT_TO_DEPLOYED_FUNCTION', checks: [] }
let stage = 'deployment-readback'
try {
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(',')); assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
  const app = clientSDK.init({ env: manifest.env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  stage = 'anonymous-login'; assert.ok(!(await app.auth().signInAnonymously()).error)
  const call = async data => {
    const r = await app.callFunction({ name: manifest.functionName, data })
    if (r.code || !r.result || typeof r.result.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
    return r.result
  }
  const hash = value => createHash('sha256').update(value).digest('hex')
  const old = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex'), next = randomBytes(32).toString('hex')
  stage = 'create-isolated-project'
  const created = await call({ action: 'project.create', request: { requestId: randomUUID(), title: '纯虚构协作链接轮换验收', collaborationSecret: old, managementSecret: manager } })
  assert.equal(created.ok, true)
  const projectId = created.value.projectId; report.fixtureProjectId = projectId
  const request = (action, secret = old, extra = {}) => ({ action, projectId, secret, ...extra })
  const current = await call(request('read')); assert.equal(current.ok, true)
  const command = { projectId, dataEpoch: current.value.dataEpoch, commandVersion: 1, operationId: randomUUID(), type: 'access.rotateCollaboration',
    payload: { collaborationHash: hash(next) }, expectedRevisions: { access: 0 } }
  const check = async (name, run) => { stage = name; const start = performance.now(); await run(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }) }
  const denied = r => assert.deepEqual(r, { ok: false, error: { code: 'FORBIDDEN' } })
  await check('management_only_access_metadata_and_rotation', async () => {
    denied(await call(request('access.read')))
    denied(await call(request('execute', old, { command })))
    assert.deepEqual(await call(request('access.read', manager, { candidateHash: hash(old) })), { ok: true, value: { revision: 0, matches: true } })
  })
  let receipt
  await check('rotate_confirm_original_receipt_and_keep_business_unchanged', async () => {
    const result = await call(request('execute', manager, { command })); assert.equal(result.ok, true); receipt = result.value
    assert.deepEqual(await call(request('receipt', manager, { dataEpoch: command.dataEpoch, operationId: command.operationId })), result)
    assert.deepEqual(await call(request('execute', manager, { command })), result)
    const after = await call(request('read', next)); assert.equal(after.ok, true)
    assert.deepEqual(after.value, current.value)
    assert.deepEqual(await call(request('access.read', manager, { candidateHash: hash(next) })), { ok: true, value: { revision: 1, matches: true } })
    const history = await call(request('history.list', next)); assert.equal(history.ok, true); assert.equal(history.value.versions.length, 0)
  })
  await check('old_link_read_write_and_receipt_denied_new_link_works', async () => {
    denied(await call(request('read')))
    const guest = { ...command, operationId: randomUUID(), type: 'guest.add', payload: { id: 'synthetic-guest', name: '虚构宾客', group: '' }, expectedRevisions: {} }
    denied(await call(request('execute', old, { command: guest })))
    denied(await call(request('receipt', old, { dataEpoch: command.dataEpoch, operationId: command.operationId })))
    assert.equal((await call(request('execute', next, { command: guest }))).ok, true)
    assert.equal((await call(request('read', manager))).value.data.guests['synthetic-guest'].name, '虚构宾客')
  })
  await check('stale_revision_and_changed_retry_cannot_replace_current_link', async () => {
    const payload = { collaborationHash: hash(randomBytes(32).toString('hex')) }
    assert.deepEqual(await call(request('execute', manager, { command: { ...command, operationId: randomUUID(), payload } })), { ok: false, error: { code: 'CONFLICT' } })
    assert.deepEqual(await call(request('execute', manager, { command: { ...command, payload } })), { ok: false, error: { code: 'OPERATION_ID_REUSED' } })
    assert.deepEqual(await call(request('access.read', manager, { candidateHash: hash(old) })), { ok: true, value: { revision: 1, matches: false } })
    for (const secret of [old, manager, next]) assert.equal(JSON.stringify(receipt).includes(secret), false)
    assert.equal((await call(request('read', next))).ok, true)
  })
  report.status = 'PASS'
  report.scope = 'Anonymous Node JS SDK to deployed function and real database. No independent browser/device UI or real network fault injection. Existing projects, ACLs and function invoke rules untouched.'
} catch {
  report.status = 'FAIL'; report.failedStage = stage
  process.exitCode = 1 // Never serialize SDK errors or credential-bearing envelopes.
} finally { await file.writeFile(JSON.stringify(report, null, 2)); await file.close(); console.log(JSON.stringify(report)) }
