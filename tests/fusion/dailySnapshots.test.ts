import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import { closeDailyProject } from '../../server/fusion/dailySnapshots.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
import type { TransactionStore } from '../../server/fusion/commandService.ts'
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('manager') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  let time = new Date('2026-10-04T15:59:50Z'), failSnapshot = false
  const wrapped: TransactionStore = { run: (id, body) => store.run(id, tx => body({ ...tx, putVersion: async v => {
    if (failSnapshot && v.kind === 'daily') throw Error('INJECTED_SNAPSHOT_FAILURE')
    await tx.putVersion(v)
  } })) }
  const now = () => time, core = commandService(wrapped, coreHandlers(), now), notes = noteService(wrapped, now), history = historyService(wrapped, now)
  const command = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  return { store, wrapped, now, core, notes, history, command, setTime: (v: string) => { time = new Date(v) }, fail: (v: boolean) => { failSnapshot = v } }
}
test('Shanghai midnight seals final core and notes before next-day mutation; timer is idempotent', async () => {
  const { store, wrapped, core, notes, history, command, now, setTime } = setup()
  await core.execute(command('guest.add', { id: 'g', name: '前一天宾客', group: '' }), 'secret')
  const payload = { id: 'n', title: '酒店', category: '酒店', content: '前一天正文' }
  await notes.execute(command('note.add', payload), 'secret')
  setTime('2026-10-04T15:59:59Z')
  await core.execute(command('guest.update', { id: 'g', patch: { notes: '午夜前最后修改' } }, { 'guest:g': 0 }), 'secret')
  assert.equal((await history.list('a', 'secret')).versions.length, 0)
  setTime('2026-10-04T16:00:01Z')
  const update = command('note.update', { ...payload, content: '次日正文' }, { 'note:n': 0 })
  await notes.execute(update, 'secret'); await notes.execute(update, 'secret')
  const first = await history.read('a', 'secret', 'daily:2026-10-04')
  assert.equal(first.core.guests.g.notes, '午夜前最后修改')
  assert.equal(first.notes[0].content, '前一天正文')
  assert.equal(first.lastBusinessCommittedAt, '2026-10-04T15:59:59.000Z')
  assert.equal(first.capturedAt, '2026-10-04T16:00:01.000Z')
  assert.equal(Date.parse(first.expiresAt!) - Date.parse(first.capturedAt), 90 * 86400000)
  const activity = structuredClone(store.projects.get('a')!.activity)
  await closeDailyProject(wrapped, 'a', now)
  assert.equal((await history.list('a', 'secret')).versions.length, 1)
  setTime('2026-10-07T00:00:00Z')
  await Promise.all([closeDailyProject(wrapped, 'a', now), closeDailyProject(wrapped, 'a', now)])
  assert.equal((await history.list('a', 'secret')).versions.length, 2)
  assert.equal((await history.read('a', 'secret', 'daily:2026-10-05')).notes[0].content, '次日正文')
  assert.deepEqual(store.projects.get('a')!.activity, activity)
})
test('failed rollover blocks next-day business write and retry cannot duplicate history', async () => {
  const { store, core, history, command, setTime, fail } = setup()
  await core.execute(command('guest.add', { id: 'g', name: '原宾客', group: '' }), 'secret')
  const before = structuredClone(store.projects.get('a'))
  setTime('2026-10-04T16:00:01Z'); fail(true)
  const update = command('guest.update', { id: 'g', patch: { name: '次日修改' } }, { 'guest:g': 0 })
  await assert.rejects(core.execute(update, 'secret'))
  assert.deepEqual(store.projects.get('a'), before)
  fail(false)
  const receipt = await core.execute(update, 'secret')
  assert.deepEqual(await core.execute(update, 'secret'), receipt)
  assert.equal((await history.list('a', 'secret')).versions.length, 1)
  assert.equal((await history.read('a', 'secret', 'daily:2026-10-04')).core.guests.g.name, '原宾客')
})
test('cross-day project restoration seals prior state before switching epoch', async () => {
  const { core, history, command, setTime } = setup()
  await history.execute(command('version.save', { name: '空项目' }, { snapshot: 0, notes: 0 }), 'manager')
  const target = (await history.list('a', 'secret')).versions[0].id
  await core.execute(command('guest.add', { id: 'g', name: '应保存在日快照里', group: '' }), 'secret')
  setTime('2026-10-04T16:00:01Z')
  await history.execute(command('version.restore', { id: target }, { snapshot: 1, notes: 0 }), 'manager')
  assert.equal((await history.read('a', 'secret', 'daily:2026-10-04')).core.guests.g.name, '应保存在日快照里')
  assert.equal((await history.list('a', 'secret')).versions.length, 3)
})
