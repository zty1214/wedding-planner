import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { emptyCore } from '../../src/fusion/core.ts'
import type { CoreGuest } from '../../src/fusion/core.ts'
import { planGuestRoster } from '../../src/fusion/guestRoster.ts'
import type { GuestRosterRow } from '../../src/fusion/guestRoster.ts'
import { GATEWAY_REQUEST_BYTES, GUEST_REPLACE } from '../../src/fusion/protocol.ts'
import type { Command } from '../../src/fusion/protocol.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { MemoryStore } from './memoryStore.ts'

const manager = 'a'.repeat(64), collab = 'b'.repeat(64), projectId = 'roster-test-project'
function setup() {
  const core = emptyCore(), store = new MemoryStore(), date = '2026-12-31'
  core.config.stayDates = [date]
  core.tableOrder = ['t']; core.tables.t = { id: 't', revision: 0, label: '第10桌', seats: 10, x: 100, y: 150, rotation: 15 }
  core.roomOrder = ['r']; core.rooms.r = { id: 'r', revision: 0, label: '标间1', type: '标间', notes: '靠窗' }
  const row = (id: string | null, i = 0): GuestRosterRow => ({ id, name: `合成宾客${i}`, phone: '00123', group: '新郎亲属', notes: '一条保留文本'.repeat(5), attendance: 'confirmed', stayNeed: i === 0 ? 'needed' : 'pending' })
  for (let i = 0; i < 134; i++) {
    const id = `g${i}`, g: CoreGuest = { ...row(id, i), id, revision: 0, side: 'bride', tableId: i < 2 ? 't' : null, seatIndex: i < 2 ? i : null, roomId: i === 0 ? 'r' : null, stayDates: i === 0 ? [date] : [] }
    core.guestOrder.push(id); core.guests[id] = g
  }
  const rows = core.guestOrder.map((id, index) => row(id, index)).filter(g => g.id !== 'g1')
  rows[0] = { ...rows[0], name: '改名仍保留安排', group: '新增标签' }; rows.push(row(null, 134))
  store.seed(projectId, { collaborationHash: hashSecret(collab), managementHash: hashSecret(manager) }, { dataEpoch: 'e', snapshotRevision: 0, data: core })
  const gateway = probeGateway(store, [projectId]), transport = gatewayTransport(projectId, manager, gateway)
  const command = (notes = 0): Command => ({ projectId, dataEpoch: 'e', operationId: randomUUID(), commandVersion: 1, type: GUEST_REPLACE, payload: { rows }, expectedRevisions: { snapshot: 0, notes } })
  return { core, store, rows, gateway, transport, command }
}

test('a 134-row replacement is an atomic management operation with receipt, safety version and preserved arrangements', async () => {
  const { core, store, rows, gateway, transport, command } = setup()
  await noteService(store).execute({ ...command(), type: 'note.add', payload: { id: 'n', category: '酒店', title: '原笔记', content: '原正文' } }, collab)
  const previous = await transport.read(), cmd = command(1)
  const original = await store.run(projectId, tx => tx.current())
  assert.ok(Buffer.byteLength(JSON.stringify(cmd)) > GATEWAY_REQUEST_BYTES)
  const viewer = gatewayTransport(projectId, collab, gateway)
  await assert.rejects(viewer.execute(cmd), { code: 'FORBIDDEN' })
  await assert.rejects(transport.execute({ ...cmd, expectedRevisions: { snapshot: 1, notes: 1 } }), { code: 'CONFLICT' })
  assert.deepEqual(await transport.read(), previous)
  assert.deepEqual((await transport.readHistory!()).versions, [])
  store.failReceipt = true
  await assert.rejects(transport.execute(cmd))
  assert.deepEqual(await store.run(projectId, tx => tx.current()), original)
  assert.deepEqual((await transport.readHistory!()).versions, [])
  store.failReceipt = false

  const storage = await openIndexedDbOutbox(new IDBFactory()), repo = projectRepository(projectId, storage, transport, async (_key, body) => body())
  try {
    await repo.open()
    assert.equal(await repo.dispatch(cmd.type, cmd.payload, cmd.expectedRevisions, cmd.dataEpoch, cmd.operationId), true)
    const current = repo.getSnapshot().snapshot!, data = current.data
    assert.equal(repo.getSnapshot().status, 'synced'); assert.equal(repo.getSnapshot().pending, 0)
    assert.notEqual(current.dataEpoch, cmd.dataEpoch); assert.equal(data.guestOrder.length, rows.length)
    assert.equal(data.guests.g0.name, '改名仍保留安排'); assert.equal(data.guests.g0.phone, '00123')
    assert.deepEqual([data.guests.g0.tableId, data.guests.g0.seatIndex, data.guests.g0.roomId, ...data.guests.g0.stayDates], ['t', 0, 'r', '2026-12-31'])
    assert.equal(data.guests.g0.side, 'bride'); assert.equal(data.guests.g0.revision, 1)
    assert.ok(data.config.customGroups.includes('新增标签')); assert.equal(data.guests.g2.revision, 0)
    assert.equal(data.guests.g1, undefined)
    const added = data.guests[data.guestOrder.at(-1)!]; assert.equal(added.name, '合成宾客134'); assert.equal(added.tableId, null); assert.equal(added.roomId, null)
    assert.deepEqual(data.tables, core.tables); assert.deepEqual(data.rooms, core.rooms); assert.deepEqual(current.notes, previous.notes)
    const history = (await transport.readHistory!()).versions; assert.equal(history.length, 1); assert.equal(history[0].kind, 'safety')
    const safety = await transport.readVersion!(history[0].id); assert.deepEqual(safety.core, previous.data); assert.deepEqual(safety.notes, previous.notes)
    const receipt = await transport.queryReceipt(cmd); assert.ok(receipt); assert.deepEqual(await transport.execute(cmd), receipt)
    assert.deepEqual(await transport.read(), current); assert.equal((await viewer.read()).dataEpoch, current.dataEpoch)
    const restore = { ...cmd, dataEpoch: current.dataEpoch, operationId: randomUUID(), type: 'version.restore', payload: { id: safety.id }, expectedRevisions: { snapshot: current.snapshotRevision, notes: current.notesRevision! } }
    await transport.execute(restore)
    const recovered = await transport.read(); assert.deepEqual(recovered.data, previous.data); assert.deepEqual(recovered.notes, previous.notes)
  } finally { repo.stop(); storage.close() }
})

test('rejects empty workbooks, bad IDs and changes that would release a retained guest arrangement', () => {
  const { core, rows } = setup()
  const first = rows[0], snapshot = structuredClone(core)
  assert.throws(() => planGuestRoster(core, []), /空表不能清空/)
  assert.throws(() => planGuestRoster(core, [{ ...first, id: 'wrong-project-id' }]), /当前项目/)
  assert.throws(() => planGuestRoster(core, [first, first]), /编号重复/)
  assert.throws(() => planGuestRoster(core, [{ ...first, attendance: 'declined' }]), /已有座位/)
  assert.throws(() => planGuestRoster(core, [{ ...first, stayNeed: 'not_needed' }]), /已有住宿/)
  assert.throws(() => planGuestRoster(core, [{ ...first, tableId: 't' }]), /字段不符合/)
  assert.deepEqual(core, snapshot)
})
