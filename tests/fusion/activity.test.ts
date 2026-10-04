import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { decodeActivity, describeActivity, incrementActivity, monthDays } from '../../src/fusion/activity.ts'
import { activityService } from '../../server/fusion/activityService.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import { recycleService } from '../../server/fusion/recycleService.ts'
import { closeDailyProject } from '../../server/fusion/dailySnapshots.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
import type { TransactionStore } from '../../server/fusion/commandService.ts'
function setup() {
  const store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('s'), managementHash: hashSecret('m') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  let time = new Date('2026-10-04T15:59:59Z')
  const now = () => time
  const command = (type: string, payload: Json, expectedRevisions = {}): Command => ({ projectId: 'a', dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  return { store, now, command, setTime: (v: string) => { time = new Date(v) } }
}
test('activity uses commit day, counts changed commands once, preserves categories through recycle restoration', async () => {
  const { store, now, command, setTime } = setup()
  const core = commandService(store, coreHandlers(), now), history = historyService(store, now), activity = activityService(store, now), recycle = recycleService(store, now)
  const add = command('guest.add', { id: 'g', name: '虚构宾客', group: '' })
  await core.execute(add, 's'); await core.execute(add, 's')
  await core.execute(command('guest.update', { id: 'g', patch: { name: '虚构宾客' } }, { 'guest:g': 0 }), 's')
  const deleted = command('guest.delete', { id: 'g' }, { 'guest:g': 0 })
  await recycle.execute(deleted, 's')
  await recycle.execute(command('recycle.restore', { id: deleted.operationId }), 's')
  await noteService(store, now).execute(command('note.add', { id: 'n', title: '', category: '酒店', content: '正文' }), 's')
  await history.execute(command('version.save', { name: '手动备份' }, { snapshot: 3, notes: 1 }), 's')
  let day = (await activity.month('a', 's', '2026-10')).days[3]
  assert.equal(day.activity.count, 4); assert.equal(day.activity.categories.guests, 3); assert.equal(day.activity.categories.notes, 1)
  assert.equal(day.activity.changes.added, 2); assert.equal(day.activity.changes.deleted, 1); assert.equal(day.activity.changes.restored, 1)
  assert.equal(day.activity.affectedGuests, 3); assert.equal(day.snapshot, 'today')
  setTime('2026-10-04T16:00:01Z')
  await closeDailyProject(store, 'a', now)
  day = (await activity.month('a', 's', '2026-10')).days[3]
  assert.equal(day.activity.count, 4); assert.equal(day.snapshot, 'ready')
  assert.equal((await history.list('a', 's', null, '2026-10-04')).versions.length, 2)
  assert.equal((await history.list('a', 's', null, '2026-10-05')).versions.length, 0)
  setTime('2027-01-04T16:00:01Z')
  assert.equal((await activity.month('a', 's', '2026-10')).days[3].snapshot, 'expired')
  await assert.rejects(activity.month('a', 'wrong', '2026-10'), { code: 'FORBIDDEN' })
})
test('failed daily generation is reported and a successful retry clears the failure marker', async () => {
  const { store, command, now, setTime } = setup()
  await commandService(store, coreHandlers(), now).execute(command('guest.add', { id: 'g', name: '虚构', group: '' }), 's')
  setTime('2026-10-05T00:00:00Z')
  const broken: TransactionStore = { run: (id, body) => store.run(id, tx => body({ ...tx, putVersion: async () => { throw Error('INJECTED') } })) }
  await assert.rejects(closeDailyProject(broken, 'a', now))
  const activity = activityService(store, now)
  assert.equal((await activity.month('a', 's', '2026-10')).days[3].snapshot, 'failed')
  assert.equal(store.projects.get('a')!.history.length, 0)
  await closeDailyProject(store, 'a', now)
  assert.equal((await activity.month('a', 's', '2026-10')).days[3].snapshot, 'ready')
  assert.equal(store.projects.get('a')!.daily!.failedAt, undefined)
})
test('legacy totals stay explicitly unclassified and malformed totals are rejected', () => {
  const old = decodeActivity('2026-10-04', { day: '2026-10-04', count: 7 })
  const next = incrementActivity(old, { category: 'layout', change: 'adjusted', affectedGuests: 0 })
  assert.equal(next.count, 8); assert.equal(next.categories.unclassified, 7); assert.equal(next.categories.layout, 1)
  assert.throws(() => decodeActivity(next.day, { ...next, count: 9 }), /INVALID_ACTIVITY/)
  assert.equal(monthDays('2028-02').length, 29); assert.equal(monthDays('2026-02').length, 28)
  assert.throws(() => monthDays('2026-13'), { code: 'INVALID_INPUT' })
  assert.equal(describeActivity({ type: 'guest.swapSeats', payload: {} }).category, 'seating')
  assert.equal(describeActivity({ type: 'guest.clearStayNeed', payload: {} }).category, 'stay')
  assert.equal(describeActivity({ type: 'table.move', payload: {} }).category, 'layout')
})
test('activity month gateway validates scope and month while returning only daily summaries', async () => {
  const store = new MemoryStore(), secret = 'a'.repeat(64)
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('manager') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a']), transport = gatewayTransport('a', secret, gateway)
  const month = await transport.readActivityMonth!('2026-10')
  assert.equal(month.days.length, 31); assert.equal(month.days[0].activity.count, 0)
  await assert.rejects(transport.readActivityMonth!('2026-99'), { code: 'INVALID_INPUT' })
  await assert.rejects(gatewayTransport('b', secret, gateway).readActivityMonth!('2026-10'), { code: 'FORBIDDEN' })
  const wrong = gatewayTransport('a', secret, async () => ({ ok: true, value: month }))
  await assert.rejects(wrong.readActivityMonth!('2026-11'), /ACTIVITY_MONTH_MISMATCH/)
})
test('activity increments roll back together with a failed business receipt', async () => {
  const { store, command, now } = setup()
  store.failReceipt = true
  await assert.rejects(commandService(store, coreHandlers(), now).execute(command('guest.add', { id: 'g', name: '不能半保存', group: '' }), 's'))
  assert.equal(store.projects.get('a')!.activity.size, 0)
  assert.equal(store.projects.get('a')!.activityDetails.size, 0)
})
