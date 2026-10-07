import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStore } from './memoryStore.ts'
import { developmentCreationDailyLimit, projectService } from '../../server/fusion/projectService.ts'
import { newCreation, creationProjectId, projectLinks } from '../../src/fusion/projectCreation.ts'
import { openCreationVault, submitCreation } from '../../src/fusion/creationVault.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { commandService } from '../../server/fusion/commandService.ts'

test('lost creation response and browser reopen deliver the same project and original two links', async () => {
  const store = new MemoryStore(), gateway = probeGateway(store, []), factory = new IDBFactory()
  let vault = await openCreationVault(factory)
  const request = newCreation('朋友的婚礼'), links = projectLinks('https://example.invalid', request)
  await assert.rejects(submitCreation(vault, async event => { await gateway(event); throw Error('LOST_RESPONSE') }, request))
  assert.equal((await vault.list())[0].confirmed, false)
  vault.close(); vault = await openCreationVault(factory)
  const saved = (await vault.list())[0].request
  const id = await submitCreation(vault, gateway, saved)
  assert.equal(id, creationProjectId(request.requestId)); assert.equal(store.projects.size, 1)
  assert.deepEqual(projectLinks('https://example.invalid', saved), links)
  assert.equal((await vault.list())[0].confirmed, true)
  assert.notEqual(request.collaborationSecret, request.managementSecret)
  assert.ok(!JSON.stringify(store.projects.get(id)).includes(request.managementSecret))
  vault.close()
})
test('request substitution and creation quota are transactional; retries do not consume quota', async () => {
  const store = new MemoryStore(), service = projectService(store, () => new Date('2026-10-04'), 1)
  const r = newCreation('项目')
  await service.create(r); await service.create(r)
  await assert.rejects(service.create({ ...r, title: '改写请求' }), { code: 'OPERATION_ID_REUSED' })
  await assert.rejects(service.create(newCreation('超过额度')), { code: 'RATE_LIMITED' })
  assert.equal(store.projects.size, 1)
  const broken = new MemoryStore()
  const failure = projectService({ run: (id, body) => broken.run(id, tx => body({ ...tx, putCurrent: async () => { throw Error('WRITE_FAILED') } })) })
  await assert.rejects(failure.create(newCreation('不能部分创建')))
  assert.equal(broken.projects.size, 0); assert.equal(broken.creationCounts.size, 0)
})
test('local creation save failure prevents network; two links have distinct permissions', async () => {
  const store = new MemoryStore(), service = projectService(store), request = newCreation('项目')
  const vault = await openCreationVault(new IDBFactory()); let called = false
  await assert.rejects(submitCreation({ ...vault, save: async () => { throw Error('QUOTA') } }, async () => { called = true }, request))
  assert.equal(called, false)
  const { projectId } = await service.create(request)
  const commands = commandService(store, new Map([['manage', { managementOnly: true, apply: data => data }]]))
  const command = { projectId, dataEpoch: request.requestId, operationId: 'op', commandVersion: 1, type: 'manage', payload: null, expectedRevisions: {} }
  await assert.rejects(commands.execute(command, request.collaborationSecret), { code: 'FORBIDDEN' })
  await commands.execute(command, request.managementSecret)
  vault.close()
})

test('development creation limit is configurable and invalid configuration never disables the bound', () => {
  assert.equal(developmentCreationDailyLimit(undefined), 200)
  assert.equal(developmentCreationDailyLimit('300'), 300)
  for (const value of ['', '0', '-1', '1.5', 'Infinity', 'NaN', '200x', ' 200 ', '9007199254740992']) {
    assert.throws(() => developmentCreationDailyLimit(value), /INVALID_DEV_CREATION_DAILY_LIMIT/)
  }
  for (const limit of [0, -1, Infinity, NaN, 1.5]) {
    assert.throws(() => projectService(new MemoryStore(), undefined, limit), /INVALID_DEV_CREATION_DAILY_LIMIT/)
  }
})

test('raising development gateway quota retains consumed count, retry identity and the new bound', async () => {
  const store = new MemoryStore(), first = newCreation('额度内项目')
  const oldGateway = probeGateway(store, [], undefined, 1)
  assert.equal((await oldGateway({ action: 'project.create', request: first })).ok, true)
  assert.deepEqual(await oldGateway({ action: 'project.create', request: newCreation('旧额度拒绝') }), { ok: false, error: { code: 'RATE_LIMITED' } })
  const gateway = probeGateway(store, [], undefined, 3)
  assert.equal((await gateway({ action: 'project.create', request: first })).ok, true)
  for (const title of ['新增二', '新增三']) assert.equal((await gateway({ action: 'project.create', request: newCreation(title) })).ok, true)
  assert.deepEqual(await gateway({ action: 'project.create', request: newCreation('新额度仍拒绝') }), { ok: false, error: { code: 'RATE_LIMITED' } })
  assert.equal(store.projects.size, 3)
  assert.deepEqual([...store.creationCounts.values()], [3])
})
