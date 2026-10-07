import type { Command } from './protocol.ts'
export interface GuestDraft {
  handoff?: Command
  id: string; projectId: string; dataEpoch: string; entityId: string
  guestRevision?: number
  name: string; group: string; phone: string; revision: number; updatedAt: string
}
export interface GuestDraftVault {
  list(projectId: string): Promise<GuestDraft[]>
  save(value: GuestDraft, expected: number | null): Promise<GuestDraft>
  remove(value: GuestDraft): Promise<void>
  close(): void
}
/** Private form drafts are separate from frozen shared commands. CAS prevents another tab being overwritten. */
export async function openGuestDraftVault(factory: IDBFactory = indexedDB): Promise<GuestDraftVault> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('planner-guest-form-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }; request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(Error('DRAFT_DATABASE_BLOCKED')) }
  })
  db.onversionchange = () => db.close()
  function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore, done: (v: T) => void, fail: (e: unknown) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode); let result: T, failure: unknown
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error ?? Error('DRAFT_WRITE_FAILED'))
      try { body(tx.objectStore('drafts'), v => { result = v }, e => { failure = e; tx.abort() }) } catch (e) { failure = e; tx.abort() }
    })
  }
  const key = (value: GuestDraft) => [value.projectId, value.id]
  return {
    close: () => db.close(),
    list: projectId => run('readonly', (store, done) => {
      const req = store.getAll(); req.onsuccess = () => done((req.result as GuestDraft[]).filter(v => v.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }),
    save: (value, expected) => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as GuestDraft | undefined
        if ((old?.revision ?? null) !== expected) { fail(Error('FORM_DRAFT_CHANGED')); return }
        const saved = { ...structuredClone(value), revision: (expected ?? -1) + 1 }
        store.put(saved, key(saved)); done(saved)
      }
    }),
    remove: value => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as GuestDraft | undefined
        if (old && old.revision !== value.revision) { fail(Error('FORM_DRAFT_CHANGED')); return }
        store.delete(key(value)); done()
      }
    }),
  }
}

/** Preserve the revision at the start of editing; never silently rebase restored input. */
export function guestDraftCommand(draft: GuestDraft, snapshot: import('./repository.ts').ProjectSnapshot): Pick<import('./protocol.ts').Command, 'type' | 'payload' | 'expectedRevisions' | 'dataEpoch'> {
  if (draft.dataEpoch !== snapshot.dataEpoch) throw Error('PROJECT_REPLACED')
  const fields = { name: draft.name.trim(), group: draft.group, phone: draft.phone.trim() }
  if (!fields.name) throw Error('INVALID_INPUT')
  const guest = snapshot.data.guests[draft.entityId]
  if (draft.guestRevision !== undefined) {
    if (!Number.isSafeInteger(draft.guestRevision) || draft.guestRevision < 0) throw Error('INVALID_INPUT')
    if (!guest) throw Error('NOT_FOUND')
    if (guest.revision !== draft.guestRevision) throw Error('CONFLICT')
    return { type: 'guest.update', payload: { id: draft.entityId, patch: fields }, expectedRevisions: { [`guest:${draft.entityId}`]: draft.guestRevision }, dataEpoch: draft.dataEpoch }
  }
  if (guest) throw Error('ALREADY_EXISTS')
  return { type: 'guest.add', payload: { id: draft.entityId, ...fields }, expectedRevisions: {}, dataEpoch: draft.dataEpoch }
}
