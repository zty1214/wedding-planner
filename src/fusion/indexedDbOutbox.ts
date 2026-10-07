import { canonicalJson } from './protocol.ts'
import { assertSameRequest } from './outbox.ts'
import type { OutboxStorage, Pending, PendingStatus, ConfirmedCopy, DraftArchive } from './outbox.ts'

const key = (projectId: string, epoch: string, operationId: string) => [projectId, epoch, operationId]
/** Resolve writes on transaction completion, never on request success alone. */
export async function openIndexedDbOutbox(factory: IDBFactory = indexedDB): Promise<OutboxStorage & { close(): void }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('wedding-planner-fusion-drafts', 3)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('outbox')) request.result.createObjectStore('outbox')
      if (!request.result.objectStoreNames.contains('archives')) request.result.createObjectStore('archives')
      if (!request.result.objectStoreNames.contains('confirmed')) request.result.createObjectStore('confirmed')
    }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('DRAFT_DATABASE_BLOCKED')) }
  })
  db.onversionchange = () => db.close()
  function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', mode)
      let result: T
      let failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('DRAFT_TRANSACTION_ABORTED'))
      tx.onerror = () => { failure ??= tx.error }
      try { run(tx.objectStore('outbox'), value => { result = value }, error => { failure = error; tx.abort() }) }
      catch (error) { failure = error; tx.abort() }
    })
  }
  return {
    close: () => db.close(),
    listArchives: projectId => new Promise<DraftArchive[]>((resolve, reject) => {
      const tx = db.transaction('archives', 'readonly'), request = tx.objectStore('archives').getAll()
      tx.oncomplete = () => resolve((request.result as DraftArchive[]).filter(a => a.projectId === projectId).sort((a, b) => b.savedAt.localeCompare(a.savedAt)))
      tx.onabort = () => reject(tx.error ?? Error('ARCHIVE_READ_FAILED'))
    }),
    archiveBatch: (projectId, expected) => new Promise<void>((resolve, reject) => {
      // The original batch is retained in the same transaction that removes it
      // from the sending queue. Quota errors cannot erase either side silently.
      const frozen = structuredClone(expected)
      const tx = db.transaction(['outbox', 'archives'], 'readwrite')
      let failure: unknown
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error ?? Error('ARCHIVE_WRITE_FAILED'))
      const store = tx.objectStore('outbox'), request = store.getAll()
      request.onsuccess = () => {
        try {
          const actual = (request.result as Pending[]).filter(p => p.command.projectId === projectId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          if (frozen.some(p => p.command.projectId !== projectId) || canonicalJson(actual) !== canonicalJson(frozen)) throw Error('DRAFTS_CHANGED')
          if (!actual.length) return
          const archive: DraftArchive = { id: crypto.randomUUID(), projectId, savedAt: new Date().toISOString(), drafts: actual }
          tx.objectStore('archives').add(archive, [projectId, archive.id])
          for (const item of actual) store.delete(key(projectId, item.command.dataEpoch, item.command.operationId))
        } catch (error) { failure = error; tx.abort() }
      }
    }),
    saveConfirmed: value => new Promise<void>((resolve, reject) => {
      // Read the queue and both copies atomically across tabs. Keep updating the
      // last confirmed copy, while pinning the pre-queue copy for comparison.
      const tx = db.transaction(['outbox', 'confirmed'], 'readwrite')
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('CACHE_WRITE_FAILED'))
      const request = tx.objectStore('outbox').getAll()
      request.onsuccess = () => {
        const pending = (request.result as Pending[]).some(p => p.command.projectId === value.projectId)
        const previous = tx.objectStore('confirmed').get(value.projectId)
        previous.onsuccess = () => {
          const old = previous.result as { current: ConfirmedCopy; baseline?: ConfirmedCopy } | undefined
          const copy = structuredClone(value)
          delete copy.snapshot.role // Roles must always come from current authorization.
          tx.objectStore('confirmed').put({ current: copy, ...(pending && old ? { baseline: old.baseline ?? old.current } : {}) }, value.projectId)
        }
      }
    }),
    readConfirmed: projectId => new Promise<ConfirmedCopy | undefined>((resolve, reject) => {
      const tx = db.transaction('confirmed', 'readonly'), request = tx.objectStore('confirmed').get(projectId)
      tx.oncomplete = () => resolve(request.result?.current); tx.onabort = () => reject(tx.error ?? Error('CACHE_READ_FAILED'))
    }),
    readDraftBaseline: projectId => new Promise<ConfirmedCopy | undefined>((resolve, reject) => {
      const tx = db.transaction('confirmed', 'readonly'), request = tx.objectStore('confirmed').get(projectId)
      tx.oncomplete = () => resolve(request.result?.baseline ?? request.result?.current); tx.onabort = () => reject(tx.error ?? Error('CACHE_READ_FAILED'))
    }),
    clearConfirmed: projectId => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('confirmed', 'readwrite')
      tx.objectStore('confirmed').delete(projectId)
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('CACHE_CLEAR_FAILED'))
    }),
    get: (projectId, epoch, operationId) => transaction<Pending | undefined>('readonly', (store, finish) => {
      const request = store.get(key(projectId, epoch, operationId))
      request.onsuccess = () => finish(request.result)
    }),
    list: (projectId, epoch) => transaction<Pending[]>('readonly', (store, finish) => {
      const request = store.getAll()
      request.onsuccess = () => finish((request.result as Pending[]).filter(entry => entry.command.projectId === projectId && (epoch === undefined || entry.command.dataEpoch === epoch)).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)))
    }),
    insert: value => transaction<void>('readwrite', (store, finish, fail) => {
      const c = value.command
      const id = key(c.projectId, c.dataEpoch, c.operationId)
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const previous: Pending | undefined = request.result
          if (previous) assertSameRequest(previous.command, c)
          else {
            const all = store.getAll()
            all.onsuccess = () => {
              const sequence = Math.max(0, ...(all.result as Pending[]).map(entry => entry.sequence ?? 0)) + 1
              store.add({ ...value, sequence }, id); finish()
            }
            return
          }
          finish()
        } catch (error) { fail(error) }
      }
    }),
    setStatus: (projectId, epoch, operationId, status: PendingStatus) => transaction<void>('readwrite', (store, finish, fail) => {
      const id = key(projectId, epoch, operationId)
      const request = store.get(id)
      request.onsuccess = () => {
        const previous: Pending | undefined = request.result
        if (!previous) { fail(new Error('OUTBOX_ENTRY_MISSING')); return }
        store.put({ ...previous, status }, id)
        finish()
      }
    }),
    removeBatch: (projectId, expected) => transaction<void>('readwrite', (store, finish, fail) => {
      const request = store.getAll()
      request.onsuccess = () => {
        try {
          const actual = (request.result as Pending[]).filter(item => item.command.projectId === projectId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          if (expected.some(item => item.command.projectId !== projectId) || canonicalJson(actual) !== canonicalJson(expected)) throw Error('DRAFTS_CHANGED')
          for (const item of actual) store.delete(key(projectId, item.command.dataEpoch, item.command.operationId))
          finish()
        } catch (error) { fail(error) }
      }
    }),
    remove: (projectId, epoch, operationId) => transaction<void>('readwrite', (store, finish) => {
      store.delete(key(projectId, epoch, operationId)); finish()
    }),
  }
}
