import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyCore } from '../../src/fusion/core.ts'
import { currentCollaborationSecret } from '../../src/fusion/currentSharing.ts'
import { newRotation } from '../../src/fusion/accessRotation.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'

function setup() {
  const store = new MemoryStore(), original = 'a'.repeat(64), manager = 'b'.repeat(64)
  store.seed('p', { collaborationHash: hashSecret(original), managementHash: hashSecret(manager) }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  return { store, original, remote: gatewayTransport('p', manager, probeGateway(store, ['p'])) }
}
test('copy resolves the current secret after rotation, with no mutation or replay of rotation requests', async () => {
  const { remote, original } = setup()
  assert.equal(await currentCollaborationSecret('p', original, [], remote), original)
  const first = await newRotation('p', 'e', 0)
  await remote.execute(first.command)
  const second = await newRotation('p', 'e', 1)
  await remote.execute(second.command)
  const before = await remote.readAccess!()
  assert.equal(await currentCollaborationSecret('p', original, [first, second], remote), second.secret)
  assert.deepEqual(await remote.readAccess!(), before)
  await assert.rejects(currentCollaborationSecret('p', original, [first], remote), /CURRENT_LINK_NOT_ON_DEVICE/)
  assert.deepEqual(await remote.readAccess!(), before)
})
test('offline, expired management access and a secret from another project cannot produce a share link', async () => {
  const { remote, original } = setup()
  const current = await newRotation('p', 'e', 0); await remote.execute(current.command)
  await assert.rejects(currentCollaborationSecret('p', original, [{ ...current, command: { ...current.command, projectId: 'other' } }], remote), /CURRENT_LINK_NOT_ON_DEVICE/)
  await assert.rejects(currentCollaborationSecret('p', original, [current], { ...remote, readAccess: async () => { throw Error('OFFLINE') } }), /OFFLINE/)
  await assert.rejects(currentCollaborationSecret('p', original, [current], { ...remote, readAccess: async () => { throw Error('FORBIDDEN') } }), /FORBIDDEN/)
})
