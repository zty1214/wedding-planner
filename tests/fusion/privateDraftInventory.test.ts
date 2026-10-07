import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { readPrivateDraftInventory } from '../../src/fusion/privateDraftInventory.ts'
import { openFieldDraftVault, fieldDraftCommand } from '../../src/fusion/fieldDrafts.ts'
import { openGuestDraftVault, guestDraftCommand } from '../../src/fusion/guestDrafts.ts'
import { openNoteDraftVault } from '../../src/fusion/noteDrafts.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'

test('project restore preserves and exposes all old forms even if target entities no longer exist', async () => {
  const factory = new IDBFactory(), store = new MemoryStore()
  store.seed('a', { collaborationHash: hashSecret('collab'), managementHash: hashSecret('manager') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const history = historyService(store)
  const save = { projectId: 'a', dataEpoch: 'e', operationId: 'save', commandVersion: 1 as const, type: 'version.save', payload: { name: '空白版本' }, expectedRevisions: { snapshot: 0, notes: 0 } }
  await history.execute(save, 'manager')
  const version = (await history.list('a', 'manager')).versions[0]
  const common = { id: 'form', projectId: 'a', dataEpoch: 'e', entityId: 'deleted', revision: -1, updatedAt: new Date().toISOString() }
  const fields = await openFieldDraftVault(factory), guests = await openGuestDraftVault(factory), notes = await openNoteDraftVault(factory)
  try {
    await fields.save({ ...common, kind: 'table', entityRevision: 0, value: '旧桌名' }, null)
    await fields.save({ ...common, projectId: 'b', kind: 'table', entityRevision: 0, value: '另一项目' }, null)
    await guests.save({ ...common, name: '未提交姓名 2', phone: '00123', group: '朋友', guestRevision: 0 }, null)
    await notes.save({ ...common, noteId: 'deleted', noteRevision: 0, category: '其他', title: '旧笔记', content: '未提交正文' }, null)
  } finally { fields.close(); guests.close(); notes.close() }
  const before = await readPrivateDraftInventory('a', factory)
  const receipt = await history.execute({ ...save, operationId: 'restore', type: 'version.restore', payload: { id: version.id } }, 'manager')
  const after = await readPrivateDraftInventory('a', factory)
  assert.deepEqual(after.fieldDrafts, before.fieldDrafts)
  assert.deepEqual(after.guestDrafts, before.guestDrafts)
  assert.deepEqual(after.noteDrafts, before.noteDrafts)
  assert.equal(after.fieldDrafts.length, 1)
  assert.equal(after.fieldDrafts[0].value, '旧桌名')
  assert.equal(after.guestDrafts[0].phone, '00123')
  assert.equal(after.noteDrafts[0].content, '未提交正文')
  assert.notEqual(receipt.resultDataEpoch, 'e')
  const savedCurrent = store.projects.get('a')!.current
  assertCore(savedCurrent.data)
  const current = { ...savedCurrent, data: savedCurrent.data }
  assert.throws(() => fieldDraftCommand(after.fieldDrafts[0], current), /PROJECT_REPLACED/)
  assert.throws(() => guestDraftCommand(after.guestDrafts[0], current), /PROJECT_REPLACED/)
  assert.deepEqual((await readPrivateDraftInventory('absent', factory)).fieldDrafts, [])
  assert.equal(JSON.stringify(after).includes('另一项目'), false)
})
