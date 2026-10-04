import test from 'node:test'
import assert from 'node:assert/strict'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'
const collab = 'a'.repeat(64), manager = 'b'.repeat(64), other = 'c'.repeat(64)
function setup() {
  const store = new MemoryStore()
  for (const [id, secret] of [['a', collab], ['b', other]]) store.seed(id,
    { collaborationHash: hashSecret(secret), managementHash: hashSecret(manager) },
    { dataEpoch: 'e1', snapshotRevision: 0, data: 0 })
  return { store, call: probeGateway(store, ['a', 'b']) }
}
const command = { projectId: 'a', dataEpoch: 'e1', operationId: 'op', commandVersion: 1,
  type: 'probe.increment', payload: null, expectedRevisions: {} }
test('gateway rejects missing/cross-project credentials and nested project substitution', async () => {
  const { call } = setup()
  for (const event of [
    { action: 'read', projectId: 'a' },
    { action: 'read', projectId: 'b', secret: collab },
    { action: 'read', projectId: 'outside', secret: manager },
    { action: 'execute', projectId: 'b', secret: other, command },
    { action: 'execute', projectId: 'a', secret: collab, command: { ...command, type: 'probe.manage' } },
  ]) assert.deepEqual(await call(event), { ok: false, error: { code: 'FORBIDDEN' } })
})
test('gateway recovers lost response through receipt and retry without double increment', async () => {
  const { call, store } = setup()
  const event = { action: 'execute', projectId: 'a', secret: collab, command }
  await call(event) // Deliberately discard successful transport response.
  const receipt = await call({ action: 'receipt', projectId: 'a', secret: collab, dataEpoch: 'e1', operationId: 'op' })
  assert.deepEqual(await call(event), receipt)
  assert.equal(store.projects.get('a')!.current.data, 1)
  store.projects.get('a')!.access.collaborationHash = hashSecret(other)
  for (const action of ['read', 'receipt', 'execute']) assert.deepEqual(
    await call({ ...event, action, dataEpoch: 'e1', operationId: 'op' }), { ok: false, error: { code: 'FORBIDDEN' } })
  assert.equal((await call({ action: 'read', projectId: 'a', secret: manager })).ok, true)
})
test('gateway bounds requests and sanitizes backend errors', async () => {
  const { call } = setup()
  assert.deepEqual(await call({ action: 'read', projectId: 'a', secret: collab, large: 'x'.repeat(17000) }), { ok: false, error: { code: 'REQUEST_TOO_LARGE' } })
  const broken = probeGateway({ run: async () => { throw Error('SECRET_BACKEND_DETAILS') } }, ['a'])
  assert.deepEqual(await broken({ action: 'read', projectId: 'a', secret: collab }), { ok: false, error: { code: 'INTERNAL_ERROR' } })
})
