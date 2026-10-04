import serverSDK from '@cloudbase/node-sdk'
import { temporaryCredential } from './cloudbase-cli.mjs'
import { PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { businessDay } from '../../server/fusion/businessTime.ts'
import clientSDK from '@cloudbase/js-sdk'
import { readFile, open } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { functionDetail } from './cloudbase-cli.mjs'
const [configPath, manifestPath, output] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide config, manifest and fresh report path')
const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (config.VITE_CLOUDBASE_ENV_ID !== 'dev-d1gh3jw1gdf06af22' || manifest.env !== config.VITE_CLOUDBASE_ENV_ID || manifest.functionName !== 'planner-fusion-gateway-probe') throw Error('INVALID_TARGET')
const file = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, bundleSha256: manifest.sha256, mode: 'JS_SDK_NODE_CLIENT_TO_DEPLOYED_FUNCTION', checks: [] }
let stage = 'deployment-readback'
try {
  assert.equal(functionDetail(manifest.env, manifest.functionName).Status, 'Active')
  const app = clientSDK.init({ env: manifest.env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  stage = 'anonymous-login'; assert.ok(!(await app.auth().signInAnonymously()).error)
  const call = async data => {
    const r = await app.callFunction({ name: manifest.functionName, data })
    if (r.code || !r.result || typeof r.result.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
    return r.result
  }
  const check = async (name, run) => { stage = name; await run(); report.checks.push({ name, passed: true }) }
  const secret = randomBytes(32).toString('hex'), managementSecret = randomBytes(32).toString('hex')
  stage = 'create-isolated-project'
  const created = await call({ action: 'project.create', request: { requestId: randomUUID(), title: '虚构回收站与换座验证', collaborationSecret: secret, managementSecret } })
  assert.equal(created.ok, true)
  const projectId = created.value.projectId
  report.fixtureProjectId = projectId
  const request = (action, extra = {}) => ({ action, projectId, secret, ...extra })
  const read = async () => { const r = await call(request('read')); assert.equal(r.ok, true); return r.value }
  const dataEpoch = (await read()).dataEpoch
  const command = (type, payload, expectedRevisions = {}) => ({ projectId, dataEpoch, operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  const send = async (type, payload, revisions = {}) => { const c = command(type, payload, revisions); const r = await call(request('execute', { command: c })); assert.equal(r.ok, true); return { c, receipt: r.value } }
  await check('atomic_swap_and_idempotent_retry', async () => {
    await send('table.add', { id: 't', label: '测试桌', seats: 2, x: 10, y: 20 })
    for (const [id, seatIndex] of [['a', 0], ['b', 1]]) {
      await send('guest.add', { id, name: '虚构宾客' + id, group: '测试' })
      await send('guest.assign', { id, tableId: 't', seatIndex }, { [`guest:${id}`]: 0, 'table:t': 0 })
    }
    const { c, receipt } = await send('guest.swapSeats', { firstId: 'a', secondId: 'b' }, { 'guest:a': 1, 'guest:b': 1, 'table:t': 0 })
    assert.deepEqual((await call(request('execute', { command: c }))).value, receipt)
    const core = (await read()).data
    assert.equal(core.guests.a.seatIndex, 1); assert.equal(core.guests.b.seatIndex, 0)
  })
  await check('delete_list_restore_associations_and_retry', async () => {
    const before = await read()
    const { c } = await send('table.deleteWithGuests', { id: 't' }, { 'table:t': 0, 'guest:a': 2, 'guest:b': 2 })
    const deleted = await read(); assert.equal(deleted.data.tables.t, undefined); assert.equal(deleted.data.guests.a.tableId, null)
    const list = await call(request('recycle.list')); assert.equal(list.ok, true); assert.equal(list.value.records.length, 1)
    assert.equal(list.value.records[0].id, c.operationId)
    const restored = await send('recycle.restore', { id: c.operationId }, { 'guest:a': 3, 'guest:b': 3 })
    assert.deepEqual((await call(request('execute', { command: restored.c }))).value, restored.receipt)
    const after = await read()
    assert.deepEqual(after.data.tableOrder, before.data.tableOrder)
    assert.equal(after.data.guests.a.seatIndex, 1); assert.equal(after.data.guests.b.seatIndex, 0)
    assert.equal(after.data.tables.t.revision, 1)
    assert.equal((await call(request('recycle.list'))).value.records.length, 0)
  })
  await check('note_delete_restore_and_retired_id_rejection', async () => {
    const payload = { id: 'note', category: '酒店', title: '虚构笔记', content: '删除后应恢复的完整正文' }
    await send('note.add', payload)
    const before = await read()
    const removed = await send('note.delete', { id: 'note' }, { 'note:note': 0 })
    assert.equal((await read()).notes.length, 0)
    const reuse = await call(request('execute', { command: command('note.add', payload) }))
    assert.equal(reuse.ok, false); assert.equal(reuse.error.code, 'CONFLICT')
    const records = (await call(request('recycle.list'))).value.records
    assert.equal(records.find(r => r.id === removed.c.operationId).changes[0].before.content, payload.content)
    await send('recycle.restore', { id: removed.c.operationId })
    const restored = await read()
    assert.equal(restored.notes[0].content, payload.content)
    assert.equal(restored.notes[0].revision, 1)
    assert.equal(restored.snapshotRevision, before.snapshotRevision)
    assert.equal(restored.notesRevision, before.notesRevision + 2)
  })
  await check('stay_date_and_need_clear_restore', async () => {
    await send('room.add', { id: 'room', label: '测试房间', type: '标间' })
    let current = await read()
    await send('stayDate.add', { date: '2027-01-01' }, { config: current.data.config.revision })
    current = await read()
    await send('guest.assignRoom', { id: 'a', roomId: 'room' }, { 'guest:a': current.data.guests.a.revision, 'room:room': 0 })
    current = await read()
    await send('guest.setStayDates', { id: 'a', dates: ['2027-01-01'] }, { 'guest:a': current.data.guests.a.revision, config: current.data.config.revision })
    current = await read()
    const removed = await send('stayDate.remove', { date: '2027-01-01' }, { config: current.data.config.revision, 'guest:a': current.data.guests.a.revision })
    current = await read()
    assert.deepEqual(current.data.guests.a.stayDates, [])
    assert.equal(current.data.guests.a.roomId, 'room')
    assert.equal((await call(request('recycle.list'))).value.records[0].type, 'stayDate.remove')
    await send('recycle.restore', { id: removed.c.operationId }, { config: current.data.config.revision, 'guest:a': current.data.guests.a.revision })
    current = await read()
    assert.deepEqual(current.data.guests.a.stayDates, ['2027-01-01'])
    const cleared = await send('guest.clearStayNeed', { id: 'a' }, { 'guest:a': current.data.guests.a.revision })
    current = await read()
    assert.equal(current.data.guests.a.stayNeed, 'not_needed'); assert.equal(current.data.guests.a.roomId, null)
    await send('recycle.restore', { id: cleared.c.operationId }, { 'guest:a': current.data.guests.a.revision })
    current = await read()
    assert.equal(current.data.guests.a.stayNeed, 'needed'); assert.equal(current.data.guests.a.roomId, 'room')
    assert.deepEqual(current.data.guests.a.stayDates, ['2027-01-01'])
  })
  await check('manual_version_freezes_core_and_text_notes', async () => {
    const before = await read()
    const saved = await send('version.save', { name: '虚构手动版本' }, { snapshot: before.snapshotRevision, notes: before.notesRevision })
    assert.deepEqual((await call(request('execute', { command: saved.c }))).value, saved.receipt)
    const list = await call(request('history.list'))
    assert.equal(list.ok, true); assert.equal(list.value.versions.length, 1)
    const id = list.value.versions[0].id
    const version = await call(request('history.read', { id }))
    assert.equal(version.ok, true)
    assert.deepEqual(version.value.core, before.data); assert.deepEqual(version.value.notes, before.notes)
    assert.equal(version.value.expiresAt, null)
    await send('guest.update', { id: 'a', patch: { name: '快照之后的修改' } }, { 'guest:a': before.data.guests.a.revision })
    assert.deepEqual((await call(request('history.read', { id }))).value, version.value)
    const denied = await call(request('history.read', { id, secret: randomBytes(32).toString('hex') }))
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'FORBIDDEN')
  })
  await check('wrong_credential_cannot_list_recycle', async () => {
    const denied = await call(request('recycle.list', { secret: randomBytes(32).toString('hex') }))
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'FORBIDDEN')
  })
  await check('manager_restore_epoch_safety_and_old_receipt', async () => {
    const before = await read()
    const target = (await call(request('history.list'))).value.versions.find(v => v.kind === 'manual')
    const version = (await call(request('history.read', { id: target.id }))).value
    const c = command('version.restore', { id: target.id }, { snapshot: before.snapshotRevision, notes: before.notesRevision })
    const denied = await call(request('execute', { command: c }))
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'FORBIDDEN')
    const result = await call(request('execute', { command: c, secret: managementSecret }))
    assert.equal(result.ok, true); assert.ok(result.value.resultDataEpoch)
    assert.deepEqual(await call(request('execute', { command: c, secret: managementSecret })), result)
    assert.deepEqual((await call(request('receipt', { dataEpoch, operationId: c.operationId }))).value, result.value)
    const restored = await read()
    assert.notEqual(restored.dataEpoch, dataEpoch)
    assert.deepEqual(restored.data, version.core); assert.deepEqual(restored.notes, version.notes)
    const list = (await call(request('history.list'))).value.versions
    const safety = (await call(request('history.read', { id: list.find(v => v.kind === 'safety').id }))).value
    assert.deepEqual(safety.core, before.data); assert.deepEqual(safety.notes, before.notes)
    const stale = await call(request('execute', { command: command('guest.add', { id: 'stale', name: '旧草稿', group: '' }) }))
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'PROJECT_REPLACED')
  })
  await check('seeded_prior_day_rollover_preserves_core_and_notes', async () => {
    // Synthetic clock boundary only: modify the state marker of this newly created fixture.
    if (!/^fusion-created-[a-f0-9-]{36}$/.test(projectId)) throw Error('INVALID_FIXTURE_ID')
    const before = await read(), yesterday = new Date(Date.now() - 86400000)
    const db = serverSDK.init({ env: manifest.env, region: 'ap-shanghai', ...temporaryCredential(manifest.env) }).database()
    const marker = await db.collection(PROBE_COLLECTIONS.current).doc(documentKey(projectId, 'daily-state')).set({ projectId,
      payload: { kind: 'daily-state', businessDate: businessDay(yesterday), lastCommittedAt: yesterday.toISOString(), sealed: false } })
    assert.ok(!marker.code)
    const c = { ...command('guest.update', { id: 'a', patch: { notes: '日结后修改' } }, { 'guest:a': before.data.guests.a.revision }), dataEpoch: before.dataEpoch }
    const result = await call(request('execute', { command: c }))
    assert.equal(result.ok, true)
    const daily = await call(request('history.read', { id: `daily:${businessDay(yesterday)}` }))
    assert.equal(daily.ok, true); assert.deepEqual(daily.value.core, before.data); assert.deepEqual(daily.value.notes, before.notes)
    assert.equal(daily.value.businessDate, businessDay(yesterday))
    assert.equal(Date.parse(daily.value.expiresAt) - Date.parse(daily.value.capturedAt), 90 * 86400000)
    assert.deepEqual(await call(request('execute', { command: c })), result)
  })
  await check('classified_activity_month_and_date_versions', async () => {
    const today = businessDay(new Date()), start = Date.now()
    const month = await call(request('activity.month', { month: today.slice(0, 7) }))
    report.activityMonthReadMs = Date.now() - start
    assert.equal(month.ok, true)
    const activity = month.value.days.find(d => d.activity.day === today).activity
    assert.ok(activity.count > 0)
    assert.equal(Object.values(activity.categories).reduce((n, value) => n + value, 0), activity.count)
    assert.equal(Object.values(activity.changes).reduce((n, value) => n + value, 0), activity.count)
    for (const category of ['guests', 'seating', 'stay', 'notes', 'layout', 'project']) assert.ok(activity.categories[category] > 0)
    assert.equal(activity.categories.unclassified, 0)
    const dayVersions = await call(request('history.list', { day: today }))
    assert.equal(dayVersions.ok, true); assert.ok(dayVersions.value.versions.length > 0)
    assert.ok(dayVersions.value.versions.every(v => v.businessDate === today))
    const denied = await call(request('activity.month', { month: today.slice(0, 7), secret: 'f'.repeat(64) }))
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'FORBIDDEN')
  })
  report.status = 'PASS'
} catch { report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1 }
finally { await file.writeFile(JSON.stringify(report, null, 2)); await file.close(); console.log(JSON.stringify(report)); }
