import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { handoffForm } from '../../src/fusion/formHandoff.ts'
import { openGuestDraftVault, guestDraftCommand } from '../../src/fusion/guestDrafts.ts'
import { openIndexedDbOutbox } from '../../src/fusion/indexedDbOutbox.ts'
import { projectRepository } from '../../src/fusion/repository.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import type { Core } from '../../src/fusion/core.ts'
import type { Command } from '../../src/fusion/protocol.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { MemoryStore } from './memoryStore.ts'

async function setup() {
  const store = new MemoryStore(), factory = new IDBFactory()
  store.seed('a', { collaborationHash: hashSecret('secret'), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const service = commandService(store, coreHandlers()), storage = await openIndexedDbOutbox(factory), vault = await openGuestDraftVault(factory)
  let offline = false, executions = 0
  const online = () => { if (offline) throw Error('OFFLINE') }
  const transport = {
    read: async () => { online(); const s = (await service.read('a', 'secret'))!; return { ...s, data: s.data as Core } },
    execute: async (c: Command) => { online(); executions++; return service.execute(c, 'secret') },
    queryReceipt: async (c: Command) => { online(); return service.queryReceipt(c.projectId, c.dataEpoch, c.operationId, 'secret') },
  }
  const repo = projectRepository('a', storage, transport, async (_key, body) => body()); await repo.open()
  let draft = await vault.save({ id: 'form', entityId: 'g', projectId: 'a', dataEpoch: 'e', name: '测试', group: '', phone: '', revision: -1, updatedAt: new Date().toISOString() }, null)
  const submit = () => handoffForm(draft, repo, () => guestDraftCommand(draft, repo.getSnapshot().snapshot!), vault.save, value => { draft = value })
  return { repo, storage, vault, transport, submit, getDraft: () => draft, count: () => executions, offline: (v: boolean) => { offline = v }, close: () => { repo.stop(); storage.close(); vault.close() } }
}

test('successful guest handoff is recoverable after form cleanup crash and later entity changes', async () => {
  const s = await setup()
  try {
    assert.ok(await s.submit()); assert.equal(s.count(), 1)
    assert.equal((await s.storage.list('a')).length, 0)
    await s.repo.dispatch('guest.update', { id: 'g', patch: { name: '后来修改' } }, { 'guest:g': 0 })
    const before = s.count()
    const recovered = await s.submit() // build would now fail ALREADY_EXISTS; receipt must win.
    assert.ok(recovered); assert.equal(s.count(), before)
    assert.equal((await s.transport.read()).data.guests.g.name, '后来修改')
    await s.vault.remove(recovered); assert.equal((await s.vault.list('a')).length, 0)
  } finally { s.close() }
})

test('queued handoff reconciliation neither executes nor approves a reopened queue', async () => {
  const s = await setup()
  try {
    s.offline(true); assert.ok(await s.submit()); s.offline(false)
    s.repo.stop()
    const reopened = projectRepository('a', s.storage, s.transport, async (_key, body) => body()); await reopened.open()
    assert.equal(reopened.getSnapshot().status, 'resume_required')
    assert.equal(await reopened.reconcileHandoff(s.getDraft().handoff!), 'queued')
    assert.equal(s.count(), 0); assert.equal((await s.storage.list('a')).length, 1)
    assert.equal(reopened.getSnapshot().status, 'resume_required'); reopened.stop()
  } finally { s.close() }
})

test('binding persistence failure prevents dispatch and receipt lookup errors preserve the form', async () => {
  const s = await setup()
  try {
    await assert.rejects(handoffForm(s.getDraft(), s.repo, () => guestDraftCommand(s.getDraft(), s.repo.getSnapshot().snapshot!), async () => { throw Error('QUOTA') }, () => {}), /QUOTA/)
    assert.equal(s.count(), 0); assert.equal((await s.storage.list('a')).length, 0)
    assert.ok(await s.submit()); s.offline(true)
    await assert.rejects(s.submit(), /OFFLINE/)
    assert.equal((await s.vault.list('a')).length, 1)
  } finally { s.close() }
})

test('same operation with changed request cannot clear a form, including a queued mismatch', async () => {
  const s = await setup()
  try {
    assert.ok(await s.submit())
    const c = s.getDraft().handoff!
    await assert.rejects(s.repo.reconcileHandoff({ ...c, payload: { id: 'g', name: '别的内容', group: '' } }), { code: 'OPERATION_ID_REUSED' })
    await s.storage.insert({ command: { ...c, payload: { id: 'g', name: '别的内容', group: '' } }, status: 'prepared' })
    await assert.rejects(s.repo.reconcileHandoff(c), { code: 'OPERATION_ID_REUSED' })
    assert.equal((await s.vault.list('a')).length, 1)
  } finally { s.close() }
})

test('unexecuted old epoch binding is retained and never sent', async () => {
  const s = await setup()
  try {
    const draft = s.getDraft(), c: Command = { ...guestDraftCommand(draft, s.repo.getSnapshot().snapshot!), projectId: 'a', operationId: draft.id, commandVersion: 1, dataEpoch: 'old' }
    await assert.rejects(handoffForm({ ...draft, dataEpoch: 'old', handoff: c }, s.repo, () => guestDraftCommand({ ...draft, dataEpoch: 'old' }, s.repo.getSnapshot().snapshot!), s.vault.save, () => {}), /PROJECT_REPLACED/)
    assert.equal(s.count(), 0)
  } finally { s.close() }
})

test('historical receipt can be reconciled after epoch replacement without projecting or sending', async () => {
  const s = await setup()
  try {
    assert.ok(await s.submit())
    const replaced = projectRepository('a', s.storage, { ...s.transport, read: async () => ({ ...(await s.transport.read()), dataEpoch: 'replacement', data: emptyCore() }) }, async (_key, body) => body())
    await replaced.open()
    assert.equal(await replaced.reconcileHandoff(s.getDraft().handoff!), 'committed')
    assert.equal(replaced.getSnapshot().snapshot!.dataEpoch, 'replacement')
    assert.equal(s.count(), 1); replaced.stop()
  } finally { s.close() }
})

test('freeze-only crash retries the same command and CAS cleanup preserves a newer form', async () => {
  const s = await setup()
  try {
    const original = s.getDraft(), handoff: Command = { ...guestDraftCommand(original, s.repo.getSnapshot().snapshot!), projectId: 'a', operationId: original.id, commandVersion: 1 }
    const frozen = await s.vault.save({ ...original, handoff }, original.revision)
    const handed = await handoffForm(frozen, s.repo, () => guestDraftCommand(frozen, s.repo.getSnapshot().snapshot!), s.vault.save, () => {})
    assert.ok(handed); assert.equal(s.count(), 1)
    const newer = await s.vault.save({ ...frozen, name: '另一页保留的内容' }, frozen.revision)
    await assert.rejects(s.vault.remove(handed), /FORM_DRAFT_CHANGED/)
    assert.deepEqual(await s.vault.list('a'), [newer])
  } finally { s.close() }
})

test('guest update, project title and group fields retain their original receipt after cleanup failure', async () => {
  const { fieldDraftCommand, fieldTarget, openFieldDraftVault } = await import('../../src/fusion/fieldDrafts.ts')
  const s = await setup(), fields = await openFieldDraftVault(new IDBFactory())
  try {
    await s.submit()
    const guest = await s.vault.save({ ...s.getDraft(), id: 'edit-form', handoff: undefined, guestRevision: 0, name: '修改' }, null)
    let frozen = guest
    const submit = () => handoffForm(frozen, s.repo, () => guestDraftCommand(frozen, s.repo.getSnapshot().snapshot!), s.vault.save, value => { frozen = value })
    assert.ok(await submit()); assert.ok(await submit())
    for (const kind of ['project', 'group'] as const) {
      const snap = s.repo.getSnapshot().snapshot!
      let draft = await fields.save({ id: `field-${kind}`, projectId: 'a', dataEpoch: 'e', kind, entityId: 'a', entityRevision: fieldTarget(snap, kind, 'a').revision, value: `新${kind}`, revision: -1, updatedAt: new Date().toISOString() }, null)
      const save = () => handoffForm(draft, s.repo, () => fieldDraftCommand(draft, s.repo.getSnapshot().snapshot!), fields.save, value => { draft = value })
      assert.ok(await save()); const count = s.count()
      assert.ok(await save()); assert.equal(s.count(), count)
    }
  } finally { s.close(); fields.close() }
})

test('note add and update recover frozen handoffs through the authenticated gateway', async () => {
  const { probeGateway } = await import('../../server/fusion/probeGateway.ts')
  const { gatewayTransport } = await import('../../src/fusion/gatewayTransport.ts')
  const { openNoteDraftVault } = await import('../../src/fusion/noteDrafts.ts')
  const secret = 'a'.repeat(64), store = new MemoryStore(), factory = new IDBFactory()
  store.seed('a', { collaborationHash: hashSecret(secret), managementHash: hashSecret('admin') }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const transport = gatewayTransport('a', secret, probeGateway(store, ['a']))
  const storage = await openIndexedDbOutbox(factory), vault = await openNoteDraftVault(factory)
  const repo = projectRepository('a', storage, transport, async (_key, body) => body()); await repo.open()
  try {
    for (const updating of [false, true]) {
      let draft = await vault.save({ id: updating ? 'update' : 'add', projectId: 'a', dataEpoch: 'e', noteId: updating ? 'n' : null, entityId: 'n', noteRevision: updating ? repo.getSnapshot().snapshot!.notes!.find(n => n.id === 'n')!.revision : null, category: '其他', title: '标题', content: updating ? '修改内容' : '内容', revision: -1, updatedAt: new Date().toISOString() }, null)
      const submit = () => handoffForm(draft, repo, (): Pick<Command, 'type' | 'payload' | 'expectedRevisions' | 'dataEpoch'> => ({ type: updating ? 'note.update' : 'note.add', payload: { id: 'n', category: draft.category, title: draft.title, content: draft.content }, expectedRevisions: updating ? { 'note:n': draft.noteRevision! } : {}, dataEpoch: 'e' }), vault.save, value => { draft = value })
      assert.ok(await submit()); const before = await transport.read()
      assert.ok(await submit()); assert.deepEqual(await transport.read(), before)
      await vault.remove(draft)
    }
  } finally { repo.stop(); vault.close(); storage.close() }
})
