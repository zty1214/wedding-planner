import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { openNoteDraftVault } from '../../src/fusion/noteDrafts.ts'
import type { NoteDraft } from '../../src/fusion/noteDrafts.ts'
const draft: NoteDraft = { id: 'draft', entityId: 'stable-note', projectId: 'a', dataEpoch: 'e', noteId: null, noteRevision: null,
  category: '酒店', title: '', content: '还没点击发布的中文正文', revision: 0, updatedAt: '2026-10-05T00:00:00Z' }

test('unpublished text survives database close/reopen and remains isolated by project', async () => {
  const factory = new IDBFactory()
  let vault = await openNoteDraftVault(factory)
  await vault.save(draft, null)
  await vault.save({ ...draft, projectId: 'b', content: '另一项目' }, null)
  vault.close(); vault = await openNoteDraftVault(factory)
  assert.equal((await vault.list('a'))[0].content, draft.content)
  assert.equal((await vault.list('a'))[0].entityId, 'stable-note')
  assert.equal((await vault.list('b'))[0].content, '另一项目')
  vault.close()
})
test('two tabs cannot silently overwrite or delete each other\'s newer form draft', async () => {
  const factory = new IDBFactory(), a = await openNoteDraftVault(factory), b = await openNoteDraftVault(factory)
  const original = await a.save(draft, null)
  const updated = await b.save({ ...original, content: '另一标签页最新正文' }, original.revision)
  await assert.rejects(a.save({ ...original, content: '旧标签覆盖' }, original.revision), /FORM_DRAFT_CHANGED/)
  await assert.rejects(a.remove(original), /FORM_DRAFT_CHANGED/)
  assert.equal((await a.list('a'))[0].content, updated.content)
  const fork = await a.save({ ...original, id: 'separate', content: '旧标签另存' }, null)
  assert.equal((await a.list('a')).length, 2)
  await a.remove(fork)
  assert.equal((await b.list('a'))[0].content, updated.content)
  a.close(); b.close()
})
test('editing drafts retain original epoch and note revision instead of silently rebasing', async () => {
  const vault = await openNoteDraftVault(new IDBFactory())
  const initial = await vault.save({ ...draft, noteId: 'stable-note', noteRevision: 3, dataEpoch: 'before-restore' }, null)
  const saved = await vault.save({ ...initial, title: '稍后修改' }, initial.revision)
  assert.equal(saved.noteRevision, 3); assert.equal(saved.dataEpoch, 'before-restore')
  await vault.remove(saved); assert.deepEqual(await vault.list('a'), [])
  vault.close()
})
