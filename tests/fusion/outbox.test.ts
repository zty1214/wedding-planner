import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { durableOutbox } from '../../src/fusion/outbox.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { commandDigest, CommandError } from '../../src/fusion/protocol.ts'
import type { Command, Receipt } from '../../src/fusion/protocol.ts'
const command: Command = { projectId: 'a', dataEpoch: 'epoch1', operationId: 'op1', commandVersion: 1, type: 'guest.add', payload: { id: 'g1' }, expectedRevisions: {} }
const receipt: Receipt = { requestDigest: await commandDigest(command), projectId: 'a', dataEpoch: 'epoch1', operationId: 'op1', committedAt: '2026-10-03T00:00:00Z', snapshotRevision: 1 }

test('request and unknown-result state are committed before network begins', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const box = durableOutbox(storage, {
    queryReceipt: async () => {
      assert.equal((await storage.get('a', 'epoch1', 'op1'))?.status, 'result_unknown')
      return null
    },
    execute: async sent => { assert.deepEqual(sent, command); return receipt },
  })
  await box.prepare(command)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'synced')
  assert.equal(await storage.get('a', 'epoch1', 'op1'), undefined)
  storage.close()
})
test('lost response and database reopen confirm original receipt without another write', async () => {
  const factory = new IDBFactory()
  let storage = await openIndexedDbOutbox(factory)
  let committed = false, writes = 0
  const transport = {
    queryReceipt: async () => committed ? receipt : null,
    execute: async () => { writes++; committed = true; throw Error('RESPONSE_LOST') },
  }
  let box = durableOutbox(storage, transport)
  await box.prepare(command)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'result_unknown')
  storage.close()
  storage = await openIndexedDbOutbox(factory)
  box = durableOutbox(storage, transport)
  assert.equal((await storage.list('a', 'epoch1')).length, 1)
  assert.equal((await storage.list('b', 'epoch1')).length, 0)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'synced')
  assert.equal(writes, 1)
  storage.close()
})
test('failed local persistence cannot send a network request', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  await storage.insert({ command, status: 'prepared' })
  let calls = 0
  const box = durableOutbox({ ...storage, setStatus: async () => { throw Error('QUOTA') } }, {
    queryReceipt: async () => { calls++; return null }, execute: async () => { calls++; return receipt },
  })
  await assert.rejects(box.send('a', 'epoch1', 'op1'), /QUOTA/)
  assert.equal(calls, 0)
  assert.equal((await storage.get('a', 'epoch1', 'op1'))?.status, 'prepared')
  storage.close()
})
test('duplicate prepare cannot replace frozen request or reset a failure state', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  await storage.insert({ command, status: 'conflict' })
  await storage.insert({ command, status: 'prepared' })
  assert.equal((await storage.get('a', 'epoch1', 'op1'))?.status, 'conflict')
  await assert.rejects(storage.insert({ command: { ...command, payload: { id: 'different' } }, status: 'prepared' }), { code: 'OPERATION_ID_REUSED' })
  assert.deepEqual((await storage.get('a', 'epoch1', 'op1'))?.command, command)
  storage.close()
})
test('project and epoch isolate persisted requests; denial retains local draft and pauses', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  let calls = 0
  const box = durableOutbox(storage, {
    queryReceipt: async () => { calls++; throw new CommandError('FORBIDDEN') }, execute: async () => { throw Error('MUST_NOT_SEND') },
  })
  await box.prepare(command)
  await assert.rejects(box.send('b', 'epoch1', 'op1'), /OUTBOX_ENTRY_MISSING/)
  await assert.rejects(box.send('a', 'epoch2', 'op1'), /OUTBOX_ENTRY_MISSING/)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'forbidden')
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'forbidden')
  assert.equal(calls, 1)
  assert.deepEqual((await storage.get('a', 'epoch1', 'op1'))?.command, command)
  storage.close()
})
test('receipt for another project does not discard the local pending operation', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const box = durableOutbox(storage, { queryReceipt: async () => ({ ...receipt, projectId: 'b' }), execute: async () => receipt })
  await box.prepare(command)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'result_unknown')
  assert.ok(await storage.get('a', 'epoch1', 'op1'))
  storage.close()
})

test('seat contention retains the draft as a conflict requiring user resolution', async () => {
  const storage = await openIndexedDbOutbox(new IDBFactory())
  const box = durableOutbox(storage, {
    queryReceipt: async () => null,
    execute: async () => { throw new CommandError('SEAT_OCCUPIED') },
  })
  await box.prepare(command)
  assert.equal((await box.send('a', 'epoch1', 'op1')).status, 'conflict')
  assert.deepEqual((await storage.get('a', 'epoch1', 'op1'))?.command, command)
  storage.close()
})
