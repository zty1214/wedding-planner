import { assertSameRequest } from './outbox.ts'
import type { OutboxStorage, Pending, PendingStatus } from './outbox.ts'

const key = (projectId: string, epoch: string, operationId: string) => [projectId, epoch, operationId]
/** Resolve writes on transaction completion, never on request success alone. */
export async function openIndexedDbOutbox(factory: IDBFactory = indexedDB): Promise<OutboxStorage & { close(): void }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('wedding-planner-fusion-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('outbox')
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
    remove: (projectId, epoch, operationId) => transaction<void>('readwrite', (store, finish) => {
      store.delete(key(projectId, epoch, operationId)); finish()
    }),
  }
}
