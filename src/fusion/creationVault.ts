import { assertCreation, creationProjectId } from './projectCreation.ts'
import type { CreationRequest } from './projectCreation.ts'
import { canonicalJson } from './protocol.ts'
export interface SavedCreation { request: CreationRequest; confirmed: boolean }
export interface CreationVault { save(request: CreationRequest): Promise<void>; confirm(requestId: string): Promise<void>; list(): Promise<SavedCreation[]>; close(): void }
export async function openCreationVault(factory: IDBFactory = indexedDB): Promise<CreationVault> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open('planner-project-links', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('creations', { keyPath: 'request.requestId' })
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
  })
  db.onversionchange = () => db.close()
  function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore, set: (v: T) => void, fail: (e: unknown) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('creations', mode); let result: T, error: unknown
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(error ?? tx.error)
      try { body(tx.objectStore('creations'), v => { result = v }, e => { error = e; tx.abort() }) } catch (e) { error = e; tx.abort() }
    })
  }
  return {
    close: () => db.close(),
    save: request => {
      assertCreation(request)
      return run<void>('readwrite', (store, set, fail) => {
        const get = store.get(request.requestId)
        get.onsuccess = () => {
          if (get.result && canonicalJson(get.result.request) !== canonicalJson(request)) { fail(Error('CREATION_REQUEST_CHANGED')); return }
          if (!get.result) store.add({ request, confirmed: false })
          set()
        }
      })
    },
    confirm: id => run<void>('readwrite', (store, set, fail) => {
      const get = store.get(id)
      get.onsuccess = () => { if (!get.result) { fail(Error('CREATION_MISSING')); return }; store.put({ ...get.result, confirmed: true }); set() }
    }),
    list: () => run<SavedCreation[]>('readonly', (store, set) => { const get = store.getAll(); get.onsuccess = () => set(get.result) }),
  }
}
export async function submitCreation(vault: CreationVault, invoke: (event: Record<string, unknown>) => Promise<unknown>, request: CreationRequest) {
  await vault.save(request)
  const result = await invoke({ action: 'project.create', request }) as { ok?: boolean; value?: { projectId?: string }; error?: { code?: string } }
  if (result?.ok !== true) throw Error(result?.error?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'CREATION_UNCONFIRMED')
  if (result.value?.projectId !== creationProjectId(request.requestId)) throw Error('CREATION_SCOPE_MISMATCH')
  await vault.confirm(request.requestId)
  return result.value.projectId
}
