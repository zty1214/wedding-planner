import type { Command } from './protocol.ts'
export type FieldKind = 'project' | 'table' | 'room' | 'roomNotes' | 'roomArrangement' | 'group' | 'version'
export interface FieldDraft {
  handoff?: Command
  id: string; projectId: string; dataEpoch: string; entityId: string; kind: FieldKind
  entityNotesRevision?: number
  entityRevision: number; value: string; revision: number; updatedAt: string
}
export interface FieldDraftVault {
  list(projectId: string): Promise<FieldDraft[]>
  save(value: FieldDraft, expected: number | null): Promise<FieldDraft>
  remove(value: FieldDraft): Promise<void>
  close(): void
}
/** Private form drafts are separate from frozen shared commands. CAS prevents another tab being overwritten. */
export async function openFieldDraftVault(factory: IDBFactory = indexedDB): Promise<FieldDraftVault> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = factory.open('planner-field-form-drafts', 1)
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
  const key = (value: FieldDraft) => [value.projectId, value.id]
  return {
    close: () => db.close(),
    list: projectId => run('readonly', (store, done) => {
      const req = store.getAll(); req.onsuccess = () => done((req.result as FieldDraft[]).filter(v => v.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }),
    save: (value, expected) => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as FieldDraft | undefined
        if ((old?.revision ?? null) !== expected) { fail(Error('FORM_DRAFT_CHANGED')); return }
        const saved = { ...structuredClone(value), revision: (expected ?? -1) + 1 }
        store.put(saved, key(saved)); done(saved)
      }
    }),
    remove: value => run('readwrite', (store, done, fail) => {
      const req = store.get(key(value)); req.onsuccess = () => {
        const old = req.result as FieldDraft | undefined
        if (old && old.revision !== value.revision) { fail(Error('FORM_DRAFT_CHANGED')); return }
        store.delete(key(value)); done()
      }
    }),
  }
}

export function fieldTarget(snapshot: import('./repository.ts').ProjectSnapshot, kind: FieldKind, entityId: string) {
  if (kind === 'version') return { revision: snapshot.snapshotRevision, value: '' }
  if (kind === 'group') return { revision: snapshot.data.config.revision, value: '' }
  const entity = kind === 'project' ? snapshot.data.config : kind === 'table' ? snapshot.data.tables[entityId] : snapshot.data.rooms[entityId]
  if (!entity) throw Error('NOT_FOUND')
  return { revision: entity.revision, value: kind === 'roomNotes' ? ('notes' in entity ? entity.notes : '') : 'title' in entity ? entity.title : entity.label }
}

/** Restored input keeps its original epoch and revision, even when the current label looks equal. */
export function fieldDraftCommand(draft: FieldDraft, snapshot: import('./repository.ts').ProjectSnapshot): Pick<import('./protocol.ts').Command, 'type' | 'payload' | 'expectedRevisions' | 'dataEpoch'> {
  if (draft.dataEpoch !== snapshot.dataEpoch) throw Error('PROJECT_REPLACED')
  if (!['project', 'table', 'room', 'roomNotes', 'roomArrangement', 'group', 'version'].includes(draft.kind) || !Number.isSafeInteger(draft.entityRevision) || draft.entityRevision < 0 || (!draft.value.trim() && draft.kind !== 'roomNotes')) throw Error('INVALID_INPUT')
  const current = fieldTarget(snapshot, draft.kind, draft.entityId)
  if (current.revision !== draft.entityRevision) throw Error('CONFLICT')
  if (draft.kind === 'roomArrangement') {
    const value = JSON.parse(draft.value) as { guestIds: string[]; dates: string[]; expectedRevisions: Record<string, number> }
    if (!Array.isArray(value.guestIds) || !Array.isArray(value.dates) || !value.expectedRevisions || value.expectedRevisions[`room:${draft.entityId}`] !== draft.entityRevision) throw Error('INVALID_INPUT')
    return { type: 'room.arrange', payload: { id: draft.entityId, guestIds: value.guestIds, dates: value.dates }, expectedRevisions: value.expectedRevisions, dataEpoch: draft.dataEpoch }
  }
  if (draft.kind === 'group') return { type: 'group.add', payload: { group: draft.value.trim() }, expectedRevisions: { config: draft.entityRevision }, dataEpoch: draft.dataEpoch }
  if (draft.kind === 'version') {
    if (!Number.isSafeInteger(draft.entityNotesRevision) || Number(draft.entityNotesRevision) < 0 || draft.value.trim().length > 100) throw Error('INVALID_INPUT')
    if (draft.entityNotesRevision !== snapshot.notesRevision) throw Error('CONFLICT')
    return { type: 'version.save', payload: { name: draft.value.trim() }, expectedRevisions: { snapshot: draft.entityRevision, notes: draft.entityNotesRevision! }, dataEpoch: draft.dataEpoch }
  }
  if (draft.kind === 'roomNotes') return { type: 'room.update', payload: { id: draft.entityId, patch: { notes: draft.value } }, expectedRevisions: { [`room:${draft.entityId}`]: draft.entityRevision }, dataEpoch: draft.dataEpoch }
  return draft.kind === 'project'
    ? { type: 'project.update', payload: { patch: { title: draft.value.trim() } }, expectedRevisions: { config: draft.entityRevision }, dataEpoch: draft.dataEpoch }
    : { type: `${draft.kind}.update`, payload: { id: draft.entityId, patch: { label: draft.value.trim() } }, expectedRevisions: { [`${draft.kind}:${draft.entityId}`]: draft.entityRevision }, dataEpoch: draft.dataEpoch }
}
