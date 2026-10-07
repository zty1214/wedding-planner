import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { fieldDraftCommand, openFieldDraftVault } from '../../src/fusion/fieldDrafts.ts'
import type { FieldDraft } from '../../src/fusion/fieldDrafts.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { ProjectSnapshot } from '../../src/fusion/repository.ts'
const snapshot = (): ProjectSnapshot => ({ dataEpoch: 'e', snapshotRevision: 3, data: { ...emptyCore(),
  tables: { t: { id: 't', revision: 2, label: '桌名', seats: 8, x: 0, y: 0, rotation: 0 } }, tableOrder: ['t'],
  rooms: { r: { id: 'r', revision: 1, label: '房号', type: '标间', notes: '' } }, roomOrder: ['r'] } })
const draft = (kind: FieldDraft['kind']): FieldDraft => ({ id: kind, kind, entityId: kind === 'project' ? 'config' : kind === 'table' ? 't' : 'r',
  entityRevision: kind === 'project' ? 0 : kind === 'table' ? 2 : 1, projectId: 'a', dataEpoch: 'e', value: ' 新名字 2 ', revision: -1, updatedAt: new Date().toISOString() })
test('all three field drafts survive reopen with original revision and preserve project isolation', async () => {
  const factory = new IDBFactory(); let vault = await openFieldDraftVault(factory)
  for (const kind of ['project', 'table', 'room'] as const) await vault.save(draft(kind), null)
  vault.close(); vault = await openFieldDraftVault(factory)
  const saved = await vault.list('a'); assert.equal(saved.length, 3); assert.deepEqual(await vault.list('b'), [])
  for (const item of saved) {
    const command = fieldDraftCommand(item, snapshot())
    assert.equal(command.type, `${item.kind}.update`)
    assert.deepEqual(command.expectedRevisions, { [item.kind === 'project' ? 'config' : `${item.kind}:${item.entityId}`]: item.entityRevision })
    assert.deepEqual(command.payload, item.kind === 'project' ? { patch: { title: '新名字 2' } } : { id: item.entityId, patch: { label: '新名字 2' } })
  }
  vault.close()
})
test('concurrent draft edits and cleanup cannot overwrite a newer local copy', async () => {
  const vault = await openFieldDraftVault(new IDBFactory())
  const first = await vault.save(draft('room'), null)
  const next = await vault.save({ ...first, value: '后一份' }, first.revision)
  await assert.rejects(vault.save({ ...first, value: '覆盖' }, first.revision), /FORM_DRAFT_CHANGED/)
  await assert.rejects(vault.remove(first), /FORM_DRAFT_CHANGED/)
  assert.deepEqual(await vault.list('a'), [next]); await vault.remove(next)
  assert.deepEqual(await vault.list('a'), []); vault.close()
})
test('restored fields reject cloud revision changes, deleted targets and restored epochs without changing saved intent', async () => {
  const vault = await openFieldDraftVault(new IDBFactory())
  for (const kind of ['project', 'table', 'room'] as const) {
    const input = await vault.save(draft(kind), null), current = snapshot()
    assert.throws(() => fieldDraftCommand(input, { ...current, dataEpoch: 'restored' }), /PROJECT_REPLACED/)
    if (kind === 'project') current.data.config.revision++
    else if (kind === 'table') current.data.tables.t.revision++
    else current.data.rooms.r.revision++
    assert.throws(() => fieldDraftCommand(input, current), /CONFLICT/)
    if (kind === 'table') { delete current.data.tables.t; assert.throws(() => fieldDraftCommand(input, current), /NOT_FOUND/) }
    if (kind === 'room') { delete current.data.rooms.r; assert.throws(() => fieldDraftCommand(input, current), /NOT_FOUND/) }
    assert.deepEqual((await vault.list('a')).find(d => d.id === input.id), input)
  }
  assert.throws(() => fieldDraftCommand({ ...draft('project'), value: ' ' }, snapshot()), /INVALID_INPUT/)
  vault.close()
})

test('new group and version names survive reopen and retain config and notes bindings', async () => {
  const factory = new IDBFactory(); let vault = await openFieldDraftVault(factory)
  const current = { ...snapshot(), notes: [], notesRevision: 4 }
  const group: FieldDraft = { ...draft('project'), id: 'group-form', kind: 'group', value: ' 新娘同事 ' }
  const version: FieldDraft = { ...draft('project'), id: 'version-form', kind: 'version', entityId: 'current', entityRevision: 3, entityNotesRevision: 4, value: ' 家人确认版 ' }
  await vault.save(group, null); await vault.save(version, null); vault.close()
  vault = await openFieldDraftVault(factory)
  try {
    const saved = await vault.list('a'); assert.equal(saved.length, 2)
    assert.deepEqual(fieldDraftCommand(saved.find(d => d.kind === 'group')!, current), { type: 'group.add', payload: { group: '新娘同事' }, expectedRevisions: { config: 0 }, dataEpoch: 'e' })
    assert.deepEqual(fieldDraftCommand(saved.find(d => d.kind === 'version')!, current), { type: 'version.save', payload: { name: '家人确认版' }, expectedRevisions: { snapshot: 3, notes: 4 }, dataEpoch: 'e' })
    assert.throws(() => fieldDraftCommand(version, { ...current, notesRevision: 5 }), /CONFLICT/)
    assert.throws(() => fieldDraftCommand(version, { ...current, snapshotRevision: 4 }), /CONFLICT/)
    assert.throws(() => fieldDraftCommand(version, { ...current, dataEpoch: 'restored' }), /PROJECT_REPLACED/)
    assert.throws(() => fieldDraftCommand({ ...version, value: '名'.repeat(101) }, current), /INVALID_INPUT/)
    const changed = structuredClone(current); changed.data.config.revision++
    assert.throws(() => fieldDraftCommand(group, changed), /CONFLICT/)
    assert.equal((await vault.list('a')).length, 2)
  } finally { vault.close() }
})
