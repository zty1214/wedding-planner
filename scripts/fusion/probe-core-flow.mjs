import { commandDigest } from '../../src/fusion/protocol.ts'
import { emptyCore } from '../../src/fusion/core.ts'
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
    await put(PROBE_COLLECTIONS.current, projectId, { dataEpoch: 'epoch1', snapshotRevision: 0, data: emptyCore() })
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
  const command = (type, payload, expectedRevisions = {}) => ({ projectId: a, dataEpoch: 'epoch1', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  async function send(type, payload, revisions = {}) {
    const c = command(type, payload, revisions)
    const r = await call(request('execute', { command: c }))
    assert.equal(r.ok, true, r.error?.code)
    return c
  }
  await check('create_guests_table_room_and_dates', async () => {
    await send('table.add', { id: 't', label: '测试桌', seats: 10, x: 50, y: 60 })
    await send('room.add', { id: 'r', label: '测试房101', type: '标间' })
    await send('stayDate.add', { date: '2027-01-01' }, { config: 0 })
    await send('stayDate.add', { date: '2027-01-02' }, { config: 1 })
    for (const id of ['g1', 'g2']) await send('guest.add', { id, name: '虚构宾客', group: '测试' })
  })
  await check('same_seat_one_winner_and_retry_receipt', async () => {
    const commands = ['g1', 'g2'].map(id => command('guest.assign', { id, tableId: 't', seatIndex: 0 }, { [`guest:${id}`]: 0, 'table:t': 0 }))
    const results = await Promise.all(commands.map(command => call(request('execute', { command }))))
    assert.equal(results.filter(x => x.ok).length, 1)
    assert.equal(results.find(x => !x.ok).error.code, 'SEAT_OCCUPIED')
    const winner = commands[results.findIndex(x => x.ok)]
    const receipt = await call(request('receipt', { dataEpoch: 'epoch1', operationId: winner.operationId }))
    assert.equal(receipt.value.requestDigest, await commandDigest(winner))
    assert.deepEqual(await call(request('execute', { command: winner })), receipt)
  })
  await check('room_independent_nights_layout_and_fresh_client_read', async () => {
    for (const [id, date] of [['g1', '2027-01-01'], ['g2', '2027-01-02']]) {
      let core = (await call(request('read'))).value.data
      await send('guest.assignRoom', { id, roomId: 'r' }, { [`guest:${id}`]: core.guests[id].revision, 'room:r': 0 })
      core = (await call(request('read'))).value.data
      await send('guest.setStayDates', { id, dates: [date] }, { [`guest:${id}`]: core.guests[id].revision, config: 2 })
    }
    await send('table.move', { id: 't', x: 300, y: 200 }, { 'table:t': 0 })
    // A separate JS SDK session exercises a fresh reader, not the writer's in-memory state.
    const reader = clientSDK.init(clientConfig)
    assert.ok(!(await reader.auth({ persistence: 'none' }).signInAnonymously()).error)
    const r = await reader.callFunction({ name: manifest.functionName, data: request('read') })
    assert.equal(r.result.ok, true)
    const core = r.result.value.data
    assert.deepEqual(core.guests.g1.stayDates, ['2027-01-01'])
    assert.deepEqual(core.guests.g2.stayDates, ['2027-01-02'])
    assert.equal(core.tables.t.x, 300); assert.equal(core.tables.t.y, 200)
    assert.equal(Object.values(core.guests).filter(g => g.tableId === 't').length, 1)
    report.structuredStateBytes = Buffer.byteLength(JSON.stringify(core))
    report.ninetyActiveDayBodyBytes = report.structuredStateBytes * 90
  })
  await check('project_isolation_and_stale_edit_rejected', async () => {
    assert.equal((await call(request('read', { projectId: b }))).error.code, 'FORBIDDEN')
    assert.equal(Object.keys((await call(request('read', { projectId: b, secret: secrets[1].collaboration }))).value.data.guests).length, 0)
    const stale = command('table.move', { id: 't', x: 0, y: 0 }, { 'table:t': 0 })
    assert.equal((await call(request('execute', { command: stale }))).error.code, 'CONFLICT')
    assert.equal((await call(request('read'))).value.data.tables.t.x, 300)
  })
  await check('review_regressions_shared_order_and_safe_accommodation', async () => {
    let core = (await call(request('read'))).value.data
    assert.deepEqual(core.guestOrder, ['g1', 'g2'])
    assert.deepEqual(core.tableOrder, ['t']); assert.deepEqual(core.roomOrder, ['r'])
    await send('guest.update', { id: 'g1', patch: { side: 'shared' } }, { 'guest:g1': core.guests.g1.revision })
    const before = (await call(request('read'))).value
    assert.equal(before.data.guests.g1.side, 'shared')
    const clearing = command('guest.assignRoom', { id: 'g1', roomId: null }, { 'guest:g1': before.data.guests.g1.revision })
    assert.equal((await call(request('execute', { command: clearing }))).error.code, 'INVALID_INPUT')
    assert.deepEqual((await call(request('read'))).value, before)
    assert.equal((await call(request('receipt', { dataEpoch: 'epoch1', operationId: clearing.operationId }))).value, null)
  })
  report.status = 'PASS'
  report.scope = 'Structured main flow in isolated fixture projects; no images, production data, UI migration, real device test or daily snapshot scheduler. Fresh reader uses a separate Node SDK session. Byte estimate is this small fixture only.'
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage
  report.errorCode = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(error.code) ? error.code : 'PROBE_FAILED'
  process.exitCode = 1
} finally {
  relay?.finish(report)
  await reportFile.writeFile(JSON.stringify(report, null, 2) + '\n'); await reportFile.close()
}
console.log(JSON.stringify(report))
