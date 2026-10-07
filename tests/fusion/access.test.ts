import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { accessService } from '../../server/fusion/accessService.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import type { Command } from '../../src/fusion/protocol.ts'
function setup() {
  const store = new MemoryStore(), manager = 'a'.repeat(64), old = 'b'.repeat(64), next = 'c'.repeat(64)
  store.seed('a', { managementHash: hashSecret(manager), collaborationHash: hashSecret(old) }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const command: Command = { projectId: 'a', dataEpoch: 'e', operationId: 'rotate', commandVersion: 1, type: 'access.rotateCollaboration', payload: { collaborationHash: hashSecret(next) }, expectedRevisions: { access: 0 } }
  return { store, manager, old, next, command, access: accessService(store), core: commandService(store, coreHandlers()) }
}
test('management rotates collaboration access atomically; old readers and writers are rejected', async () => {
  const { store, manager, old, next, command, access, core } = setup()
  const current = structuredClone(store.projects.get('a')!.current)
  assert.deepEqual(await access.read('a', manager), { revision: 0 })
  await assert.rejects(access.read('a', old), { code: 'FORBIDDEN' })
  await assert.rejects(access.execute(command, old), { code: 'FORBIDDEN' })
  const receipt = await access.execute(command, manager)
  assert.deepEqual(await access.execute(command, manager), receipt)
  assert.deepEqual(await access.read('a', manager), { revision: 1 })
  await assert.rejects(core.read('a', old), { code: 'FORBIDDEN' })
  await assert.rejects(core.execute({ ...command, operationId: 'old-write', type: 'guest.add', payload: { id: 'g', name: '旧会话', group: '' }, expectedRevisions: {} }, old), { code: 'FORBIDDEN' })
  assert.deepEqual(await core.read('a', next), current)
  assert.deepEqual(await core.read('a', manager), current)
  assert.deepEqual(store.projects.get('a')!.current, current)
  assert.equal(store.projects.get('a')!.history.length, 0)
  assert.equal(JSON.stringify(receipt).includes(next), false)
  assert.equal(JSON.stringify(store.projects.get('a')!.receipts.values().next().value).includes(next), false)
})
test('receipt failure rolls rotation back and original collaboration credential still works', async () => {
  const { store, manager, old, next, command, access, core } = setup()
  store.failReceipt = true
  await assert.rejects(access.execute(command, manager))
  assert.deepEqual(await access.read('a', manager), { revision: 0 })
  assert.ok(await core.read('a', old))
  await assert.rejects(core.read('a', next), { code: 'FORBIDDEN' })
})
test('competing rotations cannot replace a newer link and changed operation ID payload is refused', async () => {
  const { manager, command, access } = setup()
  const other = { ...command, operationId: 'other', payload: { collaborationHash: hashSecret('d'.repeat(64)) } }
  const outcomes = await Promise.allSettled([access.execute(command, manager), access.execute(other, manager)])
  assert.equal(outcomes.filter(v => v.status === 'fulfilled').length, 1)
  const rejected = outcomes.find(v => v.status === 'rejected') as PromiseRejectedResult
  assert.equal(rejected.reason.code, 'CONFLICT')
  await assert.rejects(access.execute({ ...command, payload: other.payload }, manager), { code: 'OPERATION_ID_REUSED' })
})
test('rotation refuses raw secrets, management-secret reuse, no-op hash and restored epoch', async () => {
  const { manager, old, command, access } = setup()
  for (const payload of [{ collaborationSecret: 'c'.repeat(64) }, { collaborationHash: hashSecret(manager) }, { collaborationHash: hashSecret(old) }]) {
    await assert.rejects(access.execute({ ...command, payload }, manager), { code: 'INVALID_INPUT' })
  }
  await assert.rejects(access.execute({ ...command, dataEpoch: 'old' }, manager), { code: 'PROJECT_REPLACED' })
})
test('gateway limits access metadata and rotation to the requested project management credential', async () => {
  const { store, manager, old, next, command } = setup(), gateway = probeGateway(store, ['a'])
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: old }), { ok: false, error: { code: 'FORBIDDEN' } })
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: manager }), { ok: true, value: { revision: 0 } })
  assert.deepEqual(await gateway({ action: 'execute', projectId: 'a', secret: manager, command: { ...command, projectId: 'b' } }), { ok: false, error: { code: 'FORBIDDEN' } })
  const rotated = await gateway({ action: 'execute', projectId: 'a', secret: manager, command })
  assert.equal(rotated.ok, true)
  assert.deepEqual(await gateway({ action: 'read', projectId: 'a', secret: old }), { ok: false, error: { code: 'FORBIDDEN' } })
  assert.equal((await gateway({ action: 'read', projectId: 'a', secret: next })).ok, true)
})

test('old open client stops after rotation and retains its original unsynced draft', async () => {
  const { IDBFactory } = await import('fake-indexeddb')
  const { openIndexedDbOutbox } = await import('../../src/fusion/indexedDbOutbox.ts')
  const { projectRepository } = await import('../../src/fusion/repository.ts')
  const { gatewayTransport } = await import('../../src/fusion/gatewayTransport.ts')
  const { store, manager, old, command, access } = setup(), gateway = probeGateway(store, ['a'])
  let offline = false
  const transport = gatewayTransport('a', old, async event => { if (offline) throw Error('OFFLINE'); return gateway(event) })
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const repo = projectRepository('a', storage, transport, async (_key, body) => body())
  await repo.open(); offline = true
  await repo.dispatch('guest.add', { id: 'g', name: '撤权前草稿', group: '' }, {})
  const frozen = (await repo.readDrafts())[0].command
  await access.execute(command, manager)
  offline = false; await repo.refresh()
  assert.equal(repo.getSnapshot().status, 'forbidden')
  assert.equal(repo.getSnapshot().snapshot, null)
  assert.deepEqual((await repo.readDrafts())[0].command, frozen)
  assert.equal(store.projects.get('a')!.current.snapshotRevision, 0)
  repo.stop(); storage.close()
})

test('candidate confirmation is management-only and reveals no stored digest', async () => {
  const { store, manager, old, command } = setup(), gateway = probeGateway(store, ['a'])
  const candidateHash = hashSecret(old)
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: manager, candidateHash }), { ok: true, value: { revision: 0, matches: true } })
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: old, candidateHash }), { ok: false, error: { code: 'FORBIDDEN' } })
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: manager, candidateHash: old.slice(0, 8) }), { ok: false, error: { code: 'INVALID_INPUT' } })
  await gateway({ action: 'execute', projectId: 'a', secret: manager, command })
  assert.deepEqual(await gateway({ action: 'access.read', projectId: 'a', secret: manager, candidateHash }), { ok: true, value: { revision: 1, matches: false } })
})
