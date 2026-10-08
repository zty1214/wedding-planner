import { assertCommand, canonicalJson, commandDigest } from './protocol.ts'
import type { Command } from './protocol.ts'
import type { ProjectTransport } from './repository.ts'

export interface RotationRequest { secret: string; command: Command }
export interface RotationVault {
  save(request: RotationRequest): Promise<void>
  list(projectId: string): Promise<RotationRequest[]>
  close(): void
}
export async function secretHash(secret: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))), b => b.toString(16).padStart(2, '0')).join('')
}
async function validate(request: RotationRequest) {
  assertCommand(request.command)
  if (!/^[a-f0-9]{64}$/.test(request.secret) || request.command.type !== 'access.rotateCollaboration'
    || canonicalJson(request.command.payload) !== canonicalJson({ collaborationHash: await secretHash(request.secret) })
    || Object.keys(request.command.expectedRevisions).join(',') !== 'access') throw Error('INVALID_ROTATION_REQUEST')
}
export async function newRotation(projectId: string, dataEpoch: string, revision: number): Promise<RotationRequest> {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const request = { secret, command: { projectId, dataEpoch, commandVersion: 1 as const, operationId: crypto.randomUUID(), type: 'access.rotateCollaboration',
    payload: { collaborationHash: await secretHash(secret) }, expectedRevisions: { access: revision } } }
  await validate(request); return request
}

/** Private credential vault. Do not put its records in business exports or draft panels. */
export async function openRotationVault(factory: IDBFactory = indexedDB): Promise<RotationVault> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('planner-private-link-rotations', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('requests')
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(Error('ROTATION_VAULT_BLOCKED')) }
  })
  db.onversionchange = () => db.close()
  function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('requests', mode); let result: T, failure: unknown
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error)
      try { body(tx.objectStore('requests'), value => { result = value }, error => { failure = error; tx.abort() }) } catch (error) { failure = error; tx.abort() }
    })
  }
  return {
    close: () => db.close(),
    async save(input) {
      const request = structuredClone(input); await validate(request)
      return run<void>('readwrite', (store, done, fail) => {
        const key = [request.command.projectId, request.command.operationId], get = store.get(key)
        get.onsuccess = () => {
          if (get.result && canonicalJson(get.result) !== canonicalJson(request)) { fail(Error('ROTATION_REQUEST_CHANGED')); return }
          if (!get.result) store.add(request, key)
          done()
        }
      })
    },
    list: projectId => run('readonly', (store, done) => {
      const get = store.getAll(); get.onsuccess = () => done((get.result as RotationRequest[]).filter(r => r.command.projectId === projectId))
    }),
  }
}

/** Resolve the original operation before exposing the new link as current. */
export async function submitRotation(vault: RotationVault, transport: ProjectTransport, input: RotationRequest) {
  const request = structuredClone(input), command = request.command
  await validate(request)
  if (!transport.readAccess) throw Error('ROTATION_UNAVAILABLE')
  await vault.save(request) // Failure here must cause zero network mutations.
  const receipt = await transport.queryReceipt(command) ?? await transport.execute(command)
  if (receipt.projectId !== command.projectId || receipt.dataEpoch !== command.dataEpoch || receipt.operationId !== command.operationId
    || receipt.requestDigest !== await commandDigest(command)) throw Error('ROTATION_RECEIPT_MISMATCH')
  const status = await transport.readAccess(await secretHash(request.secret))
  if (!status.matches) throw Error('ROTATION_SUPERSEDED')
  return { secret: request.secret, revision: status.revision }
}
