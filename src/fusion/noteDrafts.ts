import type { Command } from './protocol.ts'
export interface NoteDraft {
  handoff?: Command
  id: string; projectId: string; dataEpoch: string; noteId: string | null; entityId: string; noteRevision: number | null
  category: string; title: string; content: string; revision: number; updatedAt: string
}
export interface NoteDraftVault {
  list(projectId: string): Promise<NoteDraft[]>
  save(value: NoteDraft, expected: number | null): Promise<NoteDraft>
  remove(value: NoteDraft): Promise<void>
  close(): void
}
/** Private form drafts are separate from frozen shared commands. CAS prevents another tab being overwritten. */
export async function openNoteDraftVault(factory: IDBFactory = indexedDB): Promise<NoteDraftVault> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('planner-note-form-drafts', 1)
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
  const key = (value: NoteDraft) => [value.projectId, value.id]
  return {
    close: () => db.close(),
    list: projectId => run('readonly', (store, done) => {
      const req = store.getAll(); req.onsuccess = () => done((req.result as NoteDraft[]).filter(v => v.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }),
    save: (value, expected) => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as NoteDraft | undefined
        if ((old?.revision ?? null) !== expected) { fail(Error('FORM_DRAFT_CHANGED')); return }
        const saved = { ...structuredClone(value), revision: (expected ?? -1) + 1 }
        store.put(saved, key(saved)); done(saved)
      }
    }),
    remove: value => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as NoteDraft | undefined
        if (old && old.revision !== value.revision) { fail(Error('FORM_DRAFT_CHANGED')); return }
        store.delete(key(value)); done()
      }
    }),
  }
}
