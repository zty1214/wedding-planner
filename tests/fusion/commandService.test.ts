import test from 'node:test'
import assert from 'node:assert/strict'
import { commandService, hashSecret, businessDay } from '../../server/fusion/commandService.ts'
import { CommandError } from '../../src/fusion/protocol.ts'
import type { Command } from '../../src/fusion/protocol.ts'
import { MemoryStore } from './memoryStore.ts'
const access = { collaborationHash: hashSecret('fixture-collaboration'), managementHash: hashSecret('fixture-management') }
const make = (operationId = 'op1'): Command => ({ projectId: 'a', dataEpoch: 'epoch1', operationId, commandVersion: 1, type: 'increment', payload: null, expectedRevisions: {} })
function setup() {
  const store = new MemoryStore()
  store.seed('a', access, { dataEpoch: 'epoch1', snapshotRevision: 0, data: 0 })
  const handlers = new Map([
    ['increment', { apply: (data: unknown) => Number(data) + 1 }],
    ['noChange', { apply: (data: unknown) => Number(data) }],
    ['management', { managementOnly: true, apply: () => 10 }],
    ['claimSeat', { apply: (data: unknown) => { if (data !== 0) throw new CommandError('CONFLICT'); return 1 } }],
  ])
  return { store, service: commandService(store, handlers, () => new Date('2026-10-02T16:00:00Z')) }
}
test('concurrent duplicate delivery commits one result and one activity increment', async () => {
  const { store, service } = setup()
  const receipts = await Promise.all(Array.from({ length: 8 }, () => service.execute(make(), 'fixture-collaboration')))
  assert.ok(receipts.every(r => r.snapshotRevision === 1))
  assert.equal(store.projects.get('a')?.current.data, 1)
  assert.equal(store.projects.get('a')?.activity.get('2026-10-03'), 1)
})
test('business, receipt, and activity all roll back when receipt write fails', async () => {
  const { store, service } = setup(); store.failReceipt = true
  await assert.rejects(service.execute(make(), 'fixture-collaboration'))
  assert.equal(store.projects.get('a')?.current.data, 0)
  assert.equal(store.projects.get('a')?.activity.size, 0)
  store.failReceipt = false
  assert.equal((await service.execute(make(), 'fixture-collaboration')).snapshotRevision, 1)
})
test('two independent contenders cannot claim the same fixture seat', async () => {
  const { service } = setup()
  const results = await Promise.allSettled(['first', 'second'].map(op => service.execute({ ...make(op), type: 'claimSeat' }, 'fixture-collaboration')))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
})
test('cross-project, management commands and revoked credentials are denied including receipt reads', async () => {
  const { store, service } = setup()
  store.seed('b', { ...access, collaborationHash: hashSecret('other-secret') }, { dataEpoch: 'epoch1', snapshotRevision: 0, data: 0 })
  for (const c of [{ ...make(), projectId: 'b' }, { ...make(), type: 'management' }]) {
    await assert.rejects(service.execute(c, 'fixture-collaboration'), { code: 'FORBIDDEN' })
  }
  await service.execute(make(), 'fixture-collaboration')
  store.projects.get('a')!.access.collaborationHash = hashSecret('rotated')
  await assert.rejects(service.execute(make(), 'fixture-collaboration'), { code: 'FORBIDDEN' })
  await assert.rejects(service.queryReceipt('a', 'epoch1', 'op1', 'fixture-collaboration'), { code: 'FORBIDDEN' })
  assert.equal((await service.queryReceipt('a', 'epoch1', 'op1', 'fixture-management'))?.snapshotRevision, 1)
})
test('changed request reusing operation ID rejected; unknown version and malformed values fail', async () => {
  const { service } = setup()
  await service.execute(make(), 'fixture-collaboration')
  await assert.rejects(service.execute({ ...make(), payload: 'changed' }, 'fixture-collaboration'), { code: 'OPERATION_ID_REUSED' })
  for (const payload of [undefined, NaN, new Date()]) await assert.rejects(service.execute({ ...make('bad'), payload }, 'fixture-collaboration'), { code: 'INVALID_INPUT' })
  await assert.rejects(service.execute({ ...make(), commandVersion: 2 }, 'fixture-collaboration'), { code: 'UPGRADE_REQUIRED' })
})
test('old epoch receipt remains queryable but old epoch writes are rejected', async () => {
  const { store, service } = setup()
  await service.execute(make(), 'fixture-collaboration')
  store.projects.get('a')!.current.dataEpoch = 'epoch2'
  assert.equal((await service.queryReceipt('a', 'epoch1', 'op1', 'fixture-collaboration'))?.snapshotRevision, 1)
  await assert.rejects(service.execute(make(), 'fixture-collaboration'), { code: 'PROJECT_REPLACED' })
})
test('no-op has a receipt without increasing revision or heatmap', async () => {
  const { store, service } = setup()
  assert.equal((await service.execute({ ...make(), type: 'noChange' }, 'fixture-collaboration')).snapshotRevision, 0)
  assert.equal(store.projects.get('a')?.activity.size, 0)
  assert.equal(store.projects.get('a')?.receipts.size, 1)
})
test('business date switches at Shanghai midnight', () => {
  assert.equal(businessDay(new Date('2026-10-02T15:59:59Z')), '2026-10-02')
  assert.equal(businessDay(new Date('2026-10-02T16:00:00Z')), '2026-10-03')
})
