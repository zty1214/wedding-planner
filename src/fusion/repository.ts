import { editTextNote } from './notes.ts'
import type { TextNote } from './notes.ts'
import type { Core } from './core.ts'
import type { Command, Json } from './protocol.ts'
import { CommandError } from './protocol.ts'
import { durableOutbox } from './outbox.ts'
import type { CommandTransport, OutboxStorage } from './outbox.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'

export interface ProjectSnapshot { role?: 'management' | 'collaboration'; dataEpoch: string; snapshotRevision: number; data: Core; notes?: TextNote[]; notesRevision?: number }
export interface ProjectTransport extends CommandTransport { validateCommand?(command: Command): void; read(): Promise<ProjectSnapshot>; readRecycle?(): Promise<import('./recycle.ts').RecycleList>; readActivityMonth?(month: string): Promise<import('./activity.ts').ActivityMonth>; readHistory?(cursor?: string | null, day?: string | null): Promise<import('./history.ts').HistoryPage>; readVersion?(id: string): Promise<import('./history.ts').ProjectVersion> }
export type SaveState = 'loading' | 'synced' | 'saving_local' | 'local' | 'syncing' | 'unknown' | 'conflict' | 'forbidden' | 'local_error' | 'failed' | 'resume_required'
export interface RepositoryView { snapshot: ProjectSnapshot | null; status: SaveState; pending: number; error: string | null }
export type Exclusive = <T>(key: string, body: () => Promise<T>) => Promise<T>

/** One project session. UI never writes directly to a database or silently rebases a conflict. */
export function projectRepository(projectId: string, storage: OutboxStorage, transport: ProjectTransport, exclusive: Exclusive) {
  let view: RepositoryView = { snapshot: null, status: 'loading', pending: 0, error: null }
  let stopped = false, confirmed = false
  let edits: Promise<unknown> = Promise.resolve()
  const approved = new Set<string>()
  const draftKey = (c: Command) => JSON.stringify([c.dataEpoch, c.operationId])
  const listeners = new Set<() => void>()
  const box = durableOutbox(storage, transport), handlers = coreHandlers()
  function publish(patch: Partial<RepositoryView>) {
    if (stopped) return
    if (patch.status === 'forbidden') { confirmed = false; patch = { ...patch, snapshot: null } }
    view = { ...view, ...patch }; listeners.forEach(fn => fn())
  }
  function failure(error: unknown) {
    publish({ status: error instanceof CommandError && error.code === 'FORBIDDEN' ? 'forbidden' : 'unknown', error: error instanceof CommandError ? error.code : 'NETWORK_ERROR' })
  }
  async function authorizedRead<T>(read: () => Promise<T>): Promise<T> {
    try { return await read() } catch (error) {
      if (error instanceof CommandError && error.code === 'FORBIDDEN') failure(error)
      throw error
    }
  }
  async function flush() {
    if (!confirmed || stopped || !view.snapshot) return
    await exclusive(`planner:${projectId}`, async () => {
      if (stopped) return
      let epoch = view.snapshot!.dataEpoch
      const all = await storage.list(projectId)
      if (all.some(item => !approved.has(draftKey(item.command)))) {
        confirmed = false; publish({ pending: all.length, status: 'resume_required', error: null }); return
      }
      for (const item of all.filter(item => item.command.dataEpoch !== epoch)) {
        // Only confirm existing receipts for an old epoch; never execute these commands.
        await box.confirm(projectId, item.command.dataEpoch, item.command.operationId)
      }
      const pending = await storage.list(projectId)
      if (pending.some(item => !approved.has(draftKey(item.command)))) {
        confirmed = false; publish({ pending: pending.length, status: 'resume_required', error: null }); return
      }
      if (pending.some(item => item.command.dataEpoch !== epoch)) { publish({ pending: pending.length, status: 'conflict', error: 'PROJECT_REPLACED' }); return }
      if (pending.some(item => !Number.isSafeInteger(item.sequence) || Number(item.sequence) <= 0)) { publish({ status: 'failed', error: 'DRAFT_ORDER_UNKNOWN' }); return }
      publish({ pending: pending.length })
      for (const item of pending) {
        if (stopped) return
        if (item.command.dataEpoch !== epoch) { publish({ status: 'conflict', error: 'PROJECT_REPLACED' }); return }
        publish({ status: 'syncing', error: null })
        const result = await box.send(projectId, epoch, item.command.operationId)
        if (result.status !== 'synced') {
          publish({ status: result.status === 'result_unknown' ? 'unknown' : result.status === 'prepared' ? 'local' : result.status,
            error: null })
          return
        }
        if (result.receipt.resultDataEpoch) epoch = result.receipt.resultDataEpoch
        publish({ pending: Math.max(0, view.pending - 1) })
      }
      const current = await transport.read()
      // Never hide drafts from a replaced project epoch behind a clean status.
      if (current.dataEpoch !== epoch) { publish({ status: 'conflict', error: 'PROJECT_REPLACED' }); return }
      const remaining = await storage.list(projectId)
      if (remaining.length) {
        confirmed = false; publish({ snapshot: current, status: 'resume_required', pending: remaining.length, error: null }); return
      }
      publish({ snapshot: current, status: 'synced', pending: 0, error: null })
    })
  }
  return {
    async readActivityMonth(month: string) {
      if (!transport.readActivityMonth) throw Error('ACTIVITY_UNAVAILABLE')
      return authorizedRead(() => transport.readActivityMonth!(month))
    },
    async readHistory(cursor: string | null = null, day: string | null = null) {
      if (!transport.readHistory) throw Error('HISTORY_UNAVAILABLE')
      return authorizedRead(() => transport.readHistory!(cursor, day))
    },
    async readVersion(id: string) {
      if (!transport.readVersion) throw Error('HISTORY_UNAVAILABLE')
      return authorizedRead(() => transport.readVersion!(id))
    },
    async readRecycle() {
      if (!transport.readRecycle) throw Error('RECYCLE_UNAVAILABLE')
      const result = await authorizedRead(() => transport.readRecycle!())
      if (result.dataEpoch !== view.snapshot?.dataEpoch) throw new CommandError('PROJECT_REPLACED')
      return result
    },
    getSnapshot: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    stop() { stopped = true; listeners.clear() },
    async open() {
      try {
        const snapshot = await transport.read()
        const pending = await storage.list(projectId)
        if (pending.some(item => item.command.dataEpoch !== snapshot.dataEpoch)) { publish({ snapshot, pending: pending.length, status: 'conflict', error: 'PROJECT_REPLACED' }); return }
        confirmed = pending.length === 0
        publish({ snapshot, pending: pending.length, status: confirmed ? 'synced' : 'resume_required', error: null })
      } catch (error) { failure(error) }
    },
    async resume() {
      const task = edits.then(async () => {
        // Recheck access before explicitly resuming denied drafts; never alter their frozen intent.
        const snapshot = await transport.read()
        const pending = await storage.list(projectId)
        for (const item of pending) {
          approved.add(draftKey(item.command))
          if (item.status === 'forbidden') await storage.setStatus(projectId, item.command.dataEpoch, item.command.operationId, 'result_unknown')
        }
        confirmed = true
        publish({ snapshot, pending: pending.length })
        await flush()
      })
      edits = task.catch(failure)
      return edits
    },
    /** Payload and expected revisions are frozen before network I/O. */
    dispatch(type: string, payload: Json, expectedRevisions: Record<string, number>) {
      const frozen = structuredClone({ type, payload, expectedRevisions })
      const task = edits.then(async () => {
        if (stopped || !confirmed || !view.snapshot || ['conflict', 'forbidden', 'failed'].includes(view.status)) throw new Error('EDITING_PAUSED')
        if ((type === 'version.save' || type === 'version.restore') && (view.status !== 'synced' || view.pending)) throw new Error('EDITING_PAUSED')
        const snapshot = view.snapshot
        const command: Command = { projectId, dataEpoch: snapshot.dataEpoch, operationId: crypto.randomUUID(), commandVersion: 1, ...frozen }
        transport.validateCommand?.(command)
        const handler = handlers.get(type)
        if (!handler && !['version.save', 'version.restore', 'note.add', 'note.update', 'stayDate.remove', 'note.delete', 'guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed', 'recycle.restore'].includes(type)) throw new CommandError('INVALID_INPUT')
        const next = handler ? handler.apply(snapshot.data, command) as Core : snapshot.data
        let nextSnapshot = { ...snapshot, data: next }
        if (type === 'note.add' || type === 'note.update') {
          const p = command.payload as { id: string }
          const old = snapshot.notes?.find(n => n.id === p.id)
          if (type === 'note.add' && old) throw new CommandError('CONFLICT')
          if (type === 'note.update' && !old) throw new CommandError('NOT_FOUND')
          if (old && command.expectedRevisions[`note:${old.id}`] !== old.revision) throw new CommandError('CONFLICT')
          const note = editTextNote(old, command.payload, new Date().toISOString())
          nextSnapshot = { ...nextSnapshot, notes: old ? snapshot.notes!.map(n => n.id === note.id ? note : n) : [note, ...(snapshot.notes ?? [])],
            notesRevision: (snapshot.notesRevision ?? 0) + Number(!old || note.revision !== old.revision) }
        }
        publish({ status: 'saving_local', error: null })
        try { await box.prepare(command) } catch { publish({ status: 'local_error', error: 'LOCAL_SAVE_FAILED' }); return false }
        approved.add(draftKey(command))
        publish({ snapshot: nextSnapshot, status: 'local', pending: view.pending + 1 })
        try { await flush() } catch (error) { failure(error) }
        return true // The frozen request is durable even when cloud confirmation is pending.
      })
      const result = task.catch(error => { publish({ error: error instanceof CommandError ? error.code : 'EDITING_PAUSED' }); return false })
      edits = result
      return result
    },
    async refresh() {
      const task = edits.then(async () => {
        if (stopped || view.status === 'forbidden') return
        try {
          const pending = await storage.list(projectId)
          if (pending.length) {
            if (pending.some(item => !approved.has(draftKey(item.command)))) {
              confirmed = false; publish({ pending: pending.length, status: 'resume_required', error: null })
            }
            return
          }
          const snapshot = await transport.read()
          confirmed = true
          publish({ snapshot, pending: 0, status: 'synced', error: null })
        } catch (error) { failure(error) }
      })
      edits = task.catch(failure)
      return edits
    },
  }
}
