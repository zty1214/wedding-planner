import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { openGuestDraftVault } from '../../src/fusion/guestDrafts.ts'
import type { GuestDraft } from '../../src/fusion/guestDrafts.ts'
const draft: GuestDraft = { id: 'draft', projectId: 'a', dataEpoch: 'original', entityId: 'stable-guest', name: '小明 2', group: '朋友', phone: '0012345', revision: -1, updatedAt: '2026-10-05T00:00:00Z' }

test('unsubmitted guest form survives reopen with leading zeros, original epoch and stable identity', async () => {
  const factory = new IDBFactory()
  let vault = await openGuestDraftVault(factory)
  await vault.save(draft, null)
  await vault.save({ ...draft, projectId: 'b', name: '另一项目' }, null)
  vault.close(); vault = await openGuestDraftVault(factory)
  assert.deepEqual((await vault.list('a'))[0], { ...draft, revision: 0 })
  assert.equal((await vault.list('b'))[0].name, '另一项目')
  vault.close()
})
test('guest draft CAS preserves another tab edits and rejects stale removal', async () => {
  const factory = new IDBFactory(), a = await openGuestDraftVault(factory), b = await openGuestDraftVault(factory)
  const initial = await a.save(draft, null)
  const newer = await b.save({ ...initial, name: '新名字' }, initial.revision)
  await assert.rejects(a.save({ ...initial, phone: '旧修改' }, initial.revision), /FORM_DRAFT_CHANGED/)
  await assert.rejects(a.remove(initial), /FORM_DRAFT_CHANGED/)
  assert.deepEqual((await a.list('a'))[0], newer)
  await b.remove(newer); assert.deepEqual(await a.list('a'), [])
  a.close(); b.close()
})
test('failed form writes cannot report persistence and leave prior saved input intact', async () => {
  const factory = new IDBFactory(), vault = await openGuestDraftVault(factory)
  await vault.save(draft, null); vault.close()
  await assert.rejects(vault.save({ ...draft, name: '写入失败' }, 0))
  const reopened = await openGuestDraftVault(factory)
  assert.equal((await reopened.list('a'))[0].name, draft.name)
  reopened.close()
})

test('recovered guest edits retain their original revision and refuse newer cloud values or restored epochs', async () => {
  const { guestDraftCommand } = await import('../../src/fusion/guestDrafts.ts')
  const { emptyCore } = await import('../../src/fusion/core.ts')
  const vault = await openGuestDraftVault(new IDBFactory())
  const original = await vault.save({ ...draft, guestRevision: 3 }, null)
  const changed = await vault.save({ ...original, phone: '00999' }, original.revision)
  assert.equal(changed.guestRevision, 3)
  const core = emptyCore()
  core.guestOrder = ['stable-guest']
  core.guests['stable-guest'] = { id: 'stable-guest', name: '原姓名', group: '朋友', phone: '', notes: '', side: 'unset', attendance: 'pending', stayNeed: 'pending', tableId: null, seatIndex: null, roomId: null, stayDates: [], revision: 3 }
  const snapshot = { dataEpoch: 'original', snapshotRevision: 9, data: core }
  const command = guestDraftCommand(changed, snapshot)
  assert.equal(command.type, 'guest.update')
  assert.deepEqual(command.expectedRevisions, { 'guest:stable-guest': 3 })
  assert.deepEqual(command.payload, { id: 'stable-guest', patch: { name: '小明 2', group: '朋友', phone: '00999' } })
  core.guests['stable-guest'].revision = 4
  assert.throws(() => guestDraftCommand(changed, snapshot), /CONFLICT/)
  assert.throws(() => guestDraftCommand(changed, { ...snapshot, dataEpoch: 'restored' }), /PROJECT_REPLACED/)
  delete core.guests['stable-guest']
  assert.throws(() => guestDraftCommand(changed, snapshot), /NOT_FOUND/)
  assert.equal((await vault.list('a'))[0].phone, '00999')
  vault.close()
})
