import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { newRotation, openRotationVault, submitRotation } from '../../src/fusion/accessRotation.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { MemoryStore } from './memoryStore.ts'
function setup() {
  const store = new MemoryStore(), manager = 'a'.repeat(64)
  store.seed('a', { managementHash: hashSecret(manager), collaborationHash: hashSecret('b'.repeat(64)) }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a'])
  return { store, transport: gatewayTransport('a', manager, gateway) }
}
test('rotation storage failure prevents all network requests', async () => {
  const { transport } = setup(), request = await newRotation('a', 'e', 0)
  let calls = 0
  const fail = async () => { calls++; throw Error('NETWORK_SHOULD_NOT_RUN') }
  await assert.rejects(submitRotation({ save: async () => { throw Error('QUOTA') }, list: async () => [], close() {} },
    { ...transport, queryReceipt: fail, execute: fail, readAccess: fail }, request), /QUOTA/)
  assert.equal(calls, 0)
})
test('lost response survives vault reopen and confirms original operation without executing twice', async () => {
  const factory = new IDBFactory(), { store, transport } = setup(), request = await newRotation('a', 'e', 0)
  let vault = await openRotationVault(factory), executed = 0
  await assert.rejects(submitRotation(vault, { ...transport, execute: async c => {
    executed++; await transport.execute(c); throw Error('LOST_RESPONSE')
  } }, request), /LOST_RESPONSE/)
  vault.close(); vault = await openRotationVault(factory)
  const [saved] = await vault.list('a')
  assert.deepEqual(saved, request)
  const result = await submitRotation(vault, { ...transport, execute: async c => { executed++; return transport.execute(c) } }, saved)
  assert.deepEqual(result, { secret: request.secret, revision: 1 })
  assert.equal(executed, 1)
  assert.equal(store.projects.get('a')!.access.revision, 1)
  assert.deepEqual(await vault.list('other'), [])
  vault.close()
})
test('vault binds immutable operation to its secret and rejects changed requests', async () => {
  const vault = await openRotationVault(new IDBFactory()), request = await newRotation('a', 'e', 0)
  await vault.save(request); await vault.save(request)
  await assert.rejects(vault.save({ ...request, secret: 'f'.repeat(64) }), /INVALID_ROTATION_REQUEST/)
  const other = await newRotation('a', 'e', 0)
  other.command.operationId = request.command.operationId
  await assert.rejects(vault.save(other), /ROTATION_REQUEST_CHANGED/)
  assert.deepEqual(await vault.list('a'), [request]); vault.close()
})
test('later rotation prevents old receipt from advertising a superseded link', async () => {
  const { transport } = setup(), vault = await openRotationVault(new IDBFactory())
  const first = await newRotation('a', 'e', 0), second = await newRotation('a', 'e', 1)
  await submitRotation(vault, transport, first); await submitRotation(vault, transport, second)
  await assert.rejects(submitRotation(vault, transport, first), /ROTATION_SUPERSEDED/)
  assert.equal((await vault.list('a')).length, 2); vault.close()
})
test('failure during access confirmation retains recoverable secret and mismatched receipt is refused', async () => {
  const { transport } = setup(), vault = await openRotationVault(new IDBFactory()), request = await newRotation('a', 'e', 0)
  await assert.rejects(submitRotation(vault, { ...transport, readAccess: async () => { throw Error('OFFLINE') } }, request), /OFFLINE/)
  assert.equal((await submitRotation(vault, transport, request)).secret, request.secret)
  await assert.rejects(submitRotation(vault, { ...transport, queryReceipt: async c => ({ ...(await transport.queryReceipt(c))!, requestDigest: '0'.repeat(64) }) }, request), /ROTATION_RECEIPT_MISMATCH/)
  vault.close()
})
