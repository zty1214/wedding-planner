import test from 'node:test'
import assert from 'node:assert/strict'
import { describeCurrent, describePayload } from '../../src/fusion/draftDescription.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Pending } from '../../src/fusion/outbox.ts'
import type { ProjectSnapshot } from '../../src/fusion/repository.ts'
const snapshot: ProjectSnapshot = { dataEpoch: 'e', snapshotRevision: 4, data: emptyCore(), notes: [], notesRevision: 0 }
snapshot.data.tables.shared = { id: 'shared', revision: 2, label: '当前桌名', seats: 8, x: 1, y: 2, rotation: 0 }
snapshot.data.tableOrder = ['shared']
snapshot.data.guests.shared = { id: 'shared', revision: 3, name: '当前宾客', group: '', phone: '00123', notes: '', side: 'unset', attendance: 'confirmed', tableId: 'shared', seatIndex: 0, roomId: null, stayNeed: 'pending', stayDates: [] }
snapshot.data.guestOrder = ['shared']
function item(type: string): Pending { return { status: 'conflict', command: { projectId: 'a', dataEpoch: 'e', operationId: 'o', commandVersion: 1, type, payload: { id: 'shared', patch: { label: '草稿桌名' } }, expectedRevisions: { 'table:shared': 0 } } } }
test('draft target labels are resolved within entity kind and never from a new epoch', () => {
  const original = item('table.update')
  assert.match(describePayload(original, snapshot), /对应记录：当前桌名/)
  assert.doesNotMatch(describePayload(original, snapshot), /当前宾客/)
  const replaced = { ...snapshot, dataEpoch: 'new' }
  assert.doesNotMatch(describePayload(original, replaced), /当前桌名|当前宾客/)
  assert.match(describeCurrent(original, replaced), /其他数据代次/)
})
test('current values include actual dependencies and preserve leading zeros without changing frozen intent', () => {
  const original = item('table.deleteWithGuests'), frozen = structuredClone(original)
  const text = describeCurrent(original, snapshot)
  assert.match(text, /记录版本：2/); assert.match(text, /当前关联宾客（1 人）/)
  assert.match(text, /姓名：当前宾客/); assert.match(text, /电话：00123/); assert.match(text, /座号：1/)
  assert.deepEqual(original, frozen)
})
test('deleted records and unavailable note content are distinguished from empty values', () => {
  const original = item('guest.update'); original.command.payload = { id: 'missing', patch: { name: '旧姓名' } }
  assert.match(describeCurrent(original, snapshot), /记录当前不存在/)
  original.command.type = 'guest.add'
  assert.match(describeCurrent(original, snapshot), /当前没有此记录/)
  original.command.type = 'note.update'
  assert.match(describeCurrent(original, { ...snapshot, notes: undefined }), /未完整读取/)
})
