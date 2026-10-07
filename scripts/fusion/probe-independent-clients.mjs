// Two isolated Node processes, separately authenticated anonymous identities. Synthetic dev project only.
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile, open, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import clientSDK from '@cloudbase/js-sdk'
import { functionDetail } from './cloudbase-cli.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
if (process.argv[2] === '--worker') {
 let app, functionName
 process.on('message', async ({ id, action, data }) => {
  try {
   let value
   if (action === 'init') {
    functionName = data.functionName
    app = clientSDK.init({ env: data.env, region: 'ap-shanghai', accessKey: data.accessKey, persistence: 'none' })
    assert.ok(!(await app.auth().signInAnonymously()).error)
    const login = await app.auth().getLoginState(); assert.ok(login?.user?.uid)
    value = { identityHash: hash(login.user.uid) }
   } else {
    const result = await app.callFunction({ name: functionName, data })
    if (result.code || !result.result || typeof result.result.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
    value = result.result
   }
   process.send({ id, ok: true, value })
  } catch { process.send({ id, ok: false }) } // No raw SDK errors or credential-bearing envelopes.
 })
} else {
 const [configPath, manifestPath, output] = process.argv.slice(2)
 if (!configPath || !manifestPath || !output) throw Error('Provide config, manifest and fresh report path')
 const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
 if (manifest.env !== 'dev-d1gh3jw1gdf06af22' || config.VITE_CLOUDBASE_ENV_ID !== manifest.env || manifest.functionName !== 'planner-fusion-gateway-probe') throw Error('INVALID_TARGET')
 await (await open(output, 'wx', 0o600)).close()
 const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, deploymentManifestSha256: manifest.sha256, mode: 'TWO_INDEPENDENT_NODE_SDK_IDENTITIES', status: 'RUNNING', checks: [] }
 const save = () => writeFile(output, JSON.stringify(report, null, 2))
 const children = []
 const client = () => {
  const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(child)
  return (action, data) => new Promise((resolve, reject) => {
   const id = randomUUID(), timer = setTimeout(() => { cleanup(); reject(Error('CLIENT_TIMEOUT')) }, 30000)
   const cleanup = () => { clearTimeout(timer); child.off('message', reply); child.off('exit', exited) }
   const exited = () => { cleanup(); reject(Error('CLIENT_EXITED')) }
   const reply = message => { if (message.id !== id) return; cleanup(); if (message.ok) resolve(message.value); else reject(Error('CLIENT_FAILED')) }
   child.on('message', reply); child.once('exit', exited); child.send({ id, action, data })
  })
 }
 let stage = 'deployment-readback'
 try {
  await save()
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(',')); assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
  const a = client(), b = client(), init = { env: manifest.env, functionName: manifest.functionName, accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY }
  stage = 'independent-anonymous-login'
  const [identityA, identityB] = await Promise.all([a('init', init), b('init', init)])
  assert.notEqual(identityA.identityHash, identityB.identityHash)
  report.independentIdentityVerified = true // Deliberately omit identities, hashes and tokens.
  const secret = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex'), next = randomBytes(32).toString('hex')
  stage = 'create-synthetic-project'
  const created = await a('call', { action: 'project.create', request: { requestId: randomUUID(), title: '纯虚构独立身份协作验收', collaborationSecret: secret, managementSecret: manager } })
  assert.equal(created.ok, true); const projectId = created.value.projectId; report.fixtureProjectId = projectId; await save()
  const request = (action, credential = secret, extra = {}) => ({ action, projectId, secret: credential, ...extra })
  const read = await a('call', request('read')); assert.equal(read.ok, true)
  const epoch = read.value.dataEpoch
  const command = (type, payload, expectedRevisions = {}) => ({ projectId, dataEpoch: epoch, commandVersion: 1, operationId: randomUUID(), type, payload, expectedRevisions })
  const denied = result => assert.deepEqual(result, { ok: false, error: { code: 'FORBIDDEN' } })
  const check = async (name, body) => { stage = name; report.currentStage = stage; await save(); const start = performance.now(); await body(); report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }); await save() }
  await check('separate_identity_reads_shared_project_but_wrong_credential_is_denied', async () => {
   assert.deepEqual(await b('call', request('read')), read)
   denied(await b('call', request('read', randomBytes(32).toString('hex'))))
  })
  await check('separate_identities_create_records_and_observe_each_other', async () => {
   const results = await Promise.all([a('call', request('execute', secret, { command: command('guest.add', { id: 'a', name: '虚构甲', group: '' }) })), b('call', request('execute', secret, { command: command('guest.add', { id: 'b', name: '虚构乙', group: '' }) }))])
   for (const r of results) assert.equal(r.ok, true)
   const [ra, rb] = await Promise.all([a('call', request('read')), b('call', request('read'))]); assert.deepEqual(ra, rb)
   assert.deepEqual(Object.keys(ra.value.data.guests).sort(), ['a', 'b'])
  })
  await check('same_record_concurrent_update_has_one_winner', async () => {
   const commands = ['甲修改', '乙修改'].map(name => command('guest.update', { id: 'a', patch: { name } }, { 'guest:a': 0 }))
   const results = await Promise.all([a('call', request('execute', secret, { command: commands[0] })), b('call', request('execute', secret, { command: commands[1] }))])
   assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).error.code, 'CONFLICT')
   const after = await b('call', request('read')); assert.equal(after.value.data.guests.a.revision, 1)
  })
  await check('rotation_revokes_existing_other_identity_session_and_new_link_recovers', async () => {
   const oldWrite = command('guest.add', { id: 'revoked', name: '不应写入', group: '' })
   const rotate = command('access.rotateCollaboration', { collaborationHash: hash(next) }, { access: 0 })
   denied(await b('call', request('execute', secret, { command: rotate })))
   assert.equal((await a('call', request('execute', manager, { command: rotate }))).ok, true)
   denied(await b('call', request('read')))
   denied(await b('call', request('execute', secret, { command: oldWrite })))
   denied(await b('call', request('receipt', secret, { dataEpoch: epoch, operationId: rotate.operationId })))
   const after = await b('call', request('read', next)); assert.equal(after.ok, true); assert.equal(after.value.data.guests.revoked, undefined)
   assert.equal((await b('call', request('execute', next, { command: command('guest.add', { id: 'renewed', name: '新链接虚构宾客', group: '' }) }))).ok, true)
   assert.ok((await a('call', request('read', manager))).value.data.guests.renewed)
  })
  await check('restore_changes_epoch_for_both_identities_and_rejects_stale_intent', async () => {
   const before = await a('call', request('read', manager)); assert.equal(before.ok, true)
   const saveVersion = command('version.save', { name: '独立身份恢复点' }, { snapshot: before.value.snapshotRevision, notes: before.value.notesRevision })
   assert.equal((await a('call', request('execute', manager, { command: saveVersion }))).ok, true)
   const history = await a('call', request('history.list', manager))
   assert.equal(history.ok, true)
   const target = history.value.versions.find(v => v.name === '独立身份恢复点'); assert.ok(target)
   const stale = command('guest.update', { id: 'b', patch: { name: '旧代次不应重发' } }, { 'guest:b': before.value.data.guests.b.revision })
   const late = command('guest.add', { id: 'after-version', name: '恢复点之后的虚构宾客', group: '' })
   assert.equal((await b('call', request('execute', next, { command: late }))).ok, true)
   const changed = await a('call', request('read', manager)); assert.equal(changed.ok, true)
   const restore = command('version.restore', { id: target.id }, { snapshot: changed.value.snapshotRevision, notes: changed.value.notesRevision })
   denied(await b('call', request('execute', next, { command: restore })))
   const restored = await a('call', request('execute', manager, { command: restore })); assert.equal(restored.ok, true)
   assert.notEqual(restored.value.resultDataEpoch, epoch)
   const receipt = await a('call', request('receipt', manager, { dataEpoch: epoch, operationId: restore.operationId }))
   assert.deepEqual(receipt.value, restored.value)
   assert.deepEqual((await a('call', request('execute', manager, { command: restore }))).value, restored.value)
   const after = await b('call', request('read', next)); assert.equal(after.ok, true)
   assert.equal(after.value.dataEpoch, restored.value.resultDataEpoch)
   assert.deepEqual(after.value.data, before.value.data)
   const rejected = await b('call', request('execute', next, { command: stale }))
   assert.deepEqual(rejected, { ok: false, error: { code: 'PROJECT_REPLACED' } })
   denied(await b('call', request('read', secret)))
   const adminAfter = await a('call', request('read', manager))
   assert.equal(adminAfter.value.dataEpoch, after.value.dataEpoch)
   assert.deepEqual(adminAfter.value.data, after.value.data)
   const finalHistory = await a('call', request('history.list', manager))
   assert.equal(finalHistory.value.versions.filter(v => v.kind === 'safety').length, 1)
  })
  report.status = 'PASS'
  report.scope = 'Two separate Node processes with distinct anonymous uid verified in memory; real deployed gateway/database. Not browser/device UI, mobile or independent network validation. Only fresh synthetic project links rotated; environment permissions untouched.'
 } catch { report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1 }
 finally { for (const child of children) child.kill(); delete report.currentStage; await save(); console.log(JSON.stringify(report)) }
}
