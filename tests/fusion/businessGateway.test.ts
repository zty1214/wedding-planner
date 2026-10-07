import test from 'node:test'
import assert from 'node:assert/strict'
import { businessGateway } from '../../server/fusion/businessGateway.ts'
import { businessConfiguration } from '../../server/fusion/businessConfiguration.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'
const collab = 'a'.repeat(64), manager = 'b'.repeat(64)
const request = { requestId: '00000000-0000-4000-8000-000000000001', title: '虚构候选', collaborationSecret: collab, managementSecret: manager }
const projectId = 'fusion-created-' + request.requestId
function setup() {
  const store = new MemoryStore(), call = businessGateway(store, 2)
  return { store, call }
}
test('business gateway explicit creation preserves idempotence, configured quota and management/collaboration access', async () => {
  const { store, call } = setup()
  assert.deepEqual(await call({ action: 'project.create', request }), { ok: true, value: { projectId } })
  await call({ action: 'project.create', request }); assert.equal([...store.creationCounts.values()][0], 1)
  for (const secret of [manager, collab]) assert.equal((await call({ action: 'read', projectId, secret })).ok, true)
  assert.deepEqual(await call({ action: 'project.create', request: { ...request, requestId: '-'.repeat(36) } }), { ok: false, error: { code: 'INVALID_INPUT' } })
  await call({ action: 'project.create', request: { ...request, requestId: '00000000-0000-4000-8000-000000000002' } })
  assert.deepEqual(await call({ action: 'project.create', request: { ...request, requestId: '00000000-0000-4000-8000-000000000003' } }), { ok: false, error: { code: 'RATE_LIMITED' } })
})
test('unknown or cross-project credentials cannot create/grant access; migrated project requires stored access', async () => {
  const { store, call } = setup(), migrated = projectId.replace('created', 'migrated')
  assert.deepEqual(await call({ action: 'read', projectId: migrated, secret: manager }), { ok: false, error: { code: 'FORBIDDEN' } })
  assert.equal(store.projects.size, 0)
  store.seed(migrated, { managementHash: hashSecret(manager), collaborationHash: hashSecret(collab) }, { dataEpoch: 'migration-epoch', snapshotRevision: 0, data: emptyCore() })
  assert.equal((await call({ action: 'read', projectId: migrated, secret: collab })).ok, true)
  assert.deepEqual(await call({ action: 'read', projectId: migrated, secret: 'c'.repeat(64) }), { ok: false, error: { code: 'FORBIDDEN' } })
})
test('business gateway has no probe handlers or image routes and uses the original core command/receipt path', async () => {
  const { store, call } = setup(); await call({ action: 'project.create', request })
  const command = { projectId, dataEpoch: request.requestId, operationId: 'fictional-op', commandVersion: 1, type: 'probe.increment', payload: null, expectedRevisions: {} }
  assert.deepEqual(await call({ action: 'execute', projectId, secret: manager, command }), { ok: false, error: { code: 'INVALID_INPUT' } })
  for (const action of ['image.upload', 'image.read', 'image.delete']) assert.deepEqual(await call({ action, projectId, secret: manager }), { ok: false, error: { code: 'INVALID_INPUT' } })
  command.type = 'guest.add'
  const coreCommand = { ...command, payload: { id: 'fictional-guest', name: '虚构宾客', group: '' }, expectedRevisions: {} }
  const result = await call({ action: 'execute', projectId, secret: collab, command: coreCommand })
  assert.equal(result.ok, true)
  assert.deepEqual(await call({ action: 'execute', projectId, secret: collab, command: coreCommand }), result)
  assert.equal((store.projects.get(projectId)!.current.data as ReturnType<typeof emptyCore>).guestOrder.length, 1)
})
test('candidate configuration rejects source environment, probe collections and implicit production quota', () => {
  const env = { FUSION_ENV_ID: 'fictional-preprod-123', FUSION_REGION: 'ap-shanghai', FUSION_COLLECTION_PREFIX: 'planner_fusion_preprod', FUSION_CREATION_DAILY_LIMIT: '200' }
  assert.equal(businessConfiguration(env).collections.current, 'planner_fusion_preprod_current')
  for (const change of [{ FUSION_ENV_ID: 'dev-d1gh3jw1gdf06af22' }, { FUSION_COLLECTION_PREFIX: 'planner_fusion_probe' }, { FUSION_CREATION_DAILY_LIMIT: '' }, { FUSION_REGION: 'ap-beijing' }, { FUSION_CREATION_DAILY_LIMIT: '0' }]) assert.throws(() => businessConfiguration({ ...env, ...change }), /BUSINESS_GATEWAY_NOT_CONFIGURED/)
})
