import type { TextNote } from './notes.ts'
import type { Core } from './core.ts'
import type { Command, Json } from './protocol.ts'
import { assertCommand, canonicalJson, commandDigest, CommandError } from './protocol.ts'
import { assertSameRequest, durableOutbox } from './outbox.ts'
import type { CommandTransport, OutboxStorage, Pending } from './outbox.ts'
import { projectDraft } from './projectDraft.ts'
import { assertProjectVersion } from './history.ts'
import { projectRecycleDraft } from './projectRecycleDraft.ts'

export interface ProjectSnapshot { role?: 'management' | 'collaboration'; dataEpoch: string; snapshotRevision: number; data: Core; notes?: TextNote[]; notesRevision?: number }
export interface ProjectTransport extends CommandTransport { readAccess?(candidateHash?: string): Promise<{ revision: number; matches?: boolean }>; validateCommand?(command: Command): void; read(): Promise<ProjectSnapshot>; readRecycle?(): Promise<import('./recycle.ts').RecycleList>; readActivityMonth?(month: string): Promise<import('./activity.ts').ActivityMonth>; readHistory?(cursor?: string | null, day?: string | null): Promise<import('./history.ts').HistoryPage>; readVersion?(id: string): Promise<import('./history.ts').ProjectVersion> }
export interface ExportSnapshot { restoreTarget?: { id: string; name: string }; projectId: string; source: 'confirmed' | 'draft'; capturedAt: string; snapshot: ProjectSnapshot }
export type SaveState = 'loading' | 'synced' | 'saving_local' | 'local' | 'syncing' | 'unknown' | 'conflict' | 'forbidden' | 'local_error' | 'failed' | 'resume_required'
export interface RepositoryView { snapshot: ProjectSnapshot | null; status: SaveState; pending: number; error: string | null; cacheError?: string | null }
export type Exclusive = <T>(key: string, body: () => Promise<T>) => Promise<T>

/** One project session. UI never writes directly to a database or silently rebases a conflict. */
export function projectRepository(projectId: string, storage: OutboxStorage, transport: ProjectTransport, exclusive: Exclusive) {
  let view: RepositoryView = { snapshot: null, status: 'loading', pending: 0, error: null }
  let stopped = false, confirmed = false
  let cloudSnapshot: ProjectSnapshot | null = null
  let projectedDrafts = true
  let edits: Promise<unknown> = Promise.resolve()
  const approved = new Set<string>()
  const draftKey = (c: Command) => JSON.stringify([c.dataEpoch, c.operationId])
  const listeners = new Set<() => void>()
  const box = durableOutbox(storage, transport)
  function publish(patch: Partial<RepositoryView>) {
    if (stopped) return
    if (patch.status === 'synced' && patch.pending === 0) projectedDrafts = true
    if (patch.status === 'resume_required') projectedDrafts = false
    if (patch.status === 'forbidden') { cloudSnapshot = null; confirmed = false; patch = { ...patch, snapshot: null } }
    view = { ...view, ...patch }; listeners.forEach(fn => fn())
  }
  async function failure(error: unknown) {
    publish({ status: error instanceof CommandError && error.code === 'FORBIDDEN' ? 'forbidden' : 'unknown', error: error instanceof CommandError ? error.code : 'NETWORK_ERROR' })
    if (error instanceof CommandError && error.code === 'FORBIDDEN') {
      try { await storage.clearConfirmed?.(projectId); publish({ cacheError: null }) }
      catch { publish({ cacheError: 'CACHE_CLEAR_FAILED' }) }
    }
  }
  async function authorizedRead<T>(read: () => Promise<T>): Promise<T> {
    try { return await read() } catch (error) {
      if (error instanceof CommandError && error.code === 'FORBIDDEN') await failure(error)
      throw error
    }
  }
  async function readCurrent() {
    const snapshot = await authorizedRead(() => transport.read())
    if (!stopped) {
      cloudSnapshot = structuredClone(snapshot)
      try { await storage.saveConfirmed?.({ projectId, capturedAt: new Date().toISOString(), snapshot }); publish({ cacheError: null }) }
      catch { publish({ cacheError: 'CACHE_WRITE_FAILED' }) }
    }
    return snapshot
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
          if (result.status === 'conflict' || result.status === 'failed') {
            // A rejected operation and its dependants are drafts, not current arrangements.
            // Keep the entire frozen queue, but stop presenting its optimistic projection.
            projectedDrafts = false
            let current = cloudSnapshot
            let readFailed = false
            try { current = await readCurrent() } catch {
              // Authorization loss must hide even the last confirmed copy.
              if (view.status === 'forbidden') return
              readFailed = true
            }
            publish({ snapshot: current ? structuredClone(current) : null, status: result.status,
              error: current && current.dataEpoch !== epoch ? 'PROJECT_REPLACED' : readFailed ? 'CONFIRMED_READ_FAILED' : 'REJECTED_CURRENT_CONFIRMED' })
            return
          }
          if (result.status === 'forbidden') { await failure(new CommandError('FORBIDDEN')); return }
          publish({ status: result.status === 'result_unknown' ? 'unknown' : result.status === 'prepared' ? 'local' : result.status,
            error: null })
          return
        }
        if (result.receipt.resultDataEpoch) epoch = result.receipt.resultDataEpoch
        publish({ pending: Math.max(0, view.pending - 1) })
      }
      const current = await readCurrent()
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
    projectId,
    captureExport(source: 'confirmed' | 'draft' = 'confirmed'): ExportSnapshot {
      if (stopped || !view.snapshot || view.status === 'forbidden') throw Error('EXPORT_UNAVAILABLE')
      if (source === 'draft' && (!projectedDrafts || ['resume_required', 'loading', 'saving_local', 'syncing'].includes(view.status) || view.error === 'PROJECT_REPLACED')) throw Error('DRAFT_EXPORT_UNAVAILABLE')
      const snapshot = source === 'confirmed' ? cloudSnapshot : view.snapshot
      if (!snapshot) throw Error('EXPORT_UNAVAILABLE')
      return { projectId, source, capturedAt: new Date().toISOString(), snapshot: structuredClone(snapshot) }
    },
    /** Read-only reconstruction: no approvals, queue changes, sends or revision rebasing. */
    captureRecoveredDraft() {
      const task = edits.then(() => exclusive(`planner:${projectId}`, async (): Promise<ExportSnapshot> => {
        if (stopped) throw Error('EXPORT_UNAVAILABLE')
        // Authorize before reading local arrangements or querying their receipts.
        await readCurrent()
        const pending = await storage.list(projectId)
        let sequence = 0
        const committed = new Set<string>()
        const receipts = []
        for (const item of pending) {
          const c = item.command
          if (c.projectId !== projectId || !Number.isSafeInteger(item.sequence) || Number(item.sequence) <= sequence) throw Error('DRAFT_ORDER_UNKNOWN')
          sequence = Number(item.sequence)
          const receipt = await authorizedRead(() => transport.queryReceipt(c))
          if (receipt) {
            if (receipt.projectId !== projectId || receipt.dataEpoch !== c.dataEpoch || receipt.operationId !== c.operationId || receipt.requestDigest !== await commandDigest(c)) throw new CommandError('OPERATION_ID_REUSED')
            committed.add(draftKey(c)); receipts.push(receipt)
          }
        }
        // Read after receipts so a saved operation is present rather than applied twice.
        let snapshot = structuredClone(await readCurrent())
        for (const receipt of receipts) {
          if ((receipt.resultDataEpoch ?? receipt.dataEpoch) !== snapshot.dataEpoch || receipt.snapshotRevision > snapshot.snapshotRevision || (receipt.notesRevision ?? 0) > (snapshot.notesRevision ?? 0)) throw Error('DRAFT_EXPORT_UNAVAILABLE')
        }
        let restoreTarget: ExportSnapshot['restoreTarget']
        const restored = new Set<string>()
        for (const item of pending) {
          const c = item.command
          if (committed.has(draftKey(c))) continue
          if (c.dataEpoch !== snapshot.dataEpoch) throw new CommandError('PROJECT_REPLACED')
          if (['failed', 'conflict', 'forbidden'].includes(item.status)) throw Error('DRAFT_EXPORT_UNAVAILABLE')
          if (c.type === 'version.restore') {
            // Restoration changes epoch. Never pretend subsequent old-epoch edits can follow it.
            if (pending.length !== 1 || !transport.readVersion) throw Error('DRAFT_EXPORT_UNAVAILABLE')
            if (snapshot.role !== 'management') throw new CommandError('FORBIDDEN')
            if (c.expectedRevisions.snapshot !== snapshot.snapshotRevision || c.expectedRevisions.notes !== snapshot.notesRevision) throw new CommandError('CONFLICT')
            const p = c.payload
            if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1 || typeof p.id !== 'string') throw new CommandError('INVALID_INPUT')
            const target = await authorizedRead(() => transport.readVersion!(p.id as string))
            assertProjectVersion(target)
            if (target.id !== p.id || (target.expiresAt && Date.parse(target.expiresAt) <= Date.now())) throw new CommandError('CONFLICT')
            // Keep the source epoch/revision as provenance: no new epoch exists until commit.
            snapshot = { ...snapshot, data: structuredClone(target.core), notes: structuredClone(target.notes) }
            restoreTarget = { id: target.id, name: target.name }
            continue
          }
          if (c.type === 'recycle.restore') {
            if (!transport.readRecycle) throw Error('RECYCLE_UNAVAILABLE')
            const list = await authorizedRead(() => transport.readRecycle!())
            const id = c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload) ? c.payload.id : null
            const record = list.records.find(r => r.id === id && r.dataEpoch === c.dataEpoch)
            if (list.dataEpoch !== snapshot.dataEpoch) throw new CommandError('PROJECT_REPLACED')
            if (!record || restored.has(record.id)) throw new CommandError('CONFLICT')
            snapshot = projectRecycleDraft(snapshot, c, record)
            restored.add(record.id)
            continue
          }
          const projected = projectDraft(snapshot, c)
          if (!projected.complete) throw Error('DRAFT_EXPORT_UNAVAILABLE')
          snapshot = projected.snapshot
        }
        if (stopped || canonicalJson(pending) !== canonicalJson(await storage.list(projectId))) throw Error('DRAFTS_CHANGED')
        return { projectId, source: 'draft', capturedAt: new Date().toISOString(), snapshot, ...(restoreTarget ? { restoreTarget } : {}) }
      }))
      edits = task.catch(() => undefined)
      return task
    },
    async readDraftCurrent() {
      if (stopped) throw Error('EDITING_PAUSED')
      const current = await readCurrent()
      if (stopped || view.status === 'forbidden') throw Error('EDITING_PAUSED')
      return structuredClone(current)
    },
    async readDraftArchives() { return structuredClone(await storage.listArchives?.(projectId) ?? []) },
    async readDrafts() { return structuredClone(await storage.list(projectId)) },
    async readDraftBase() {
      if (stopped) throw Error('CACHE_UNAVAILABLE')
      // Read only after successful current authorization. Offline/denied sessions
      // retain private intents but may not reveal a previously cached arrangement.
      const current = await readCurrent()
      const cached = await storage.readDraftBaseline?.(projectId)
      if (stopped || view.status === 'forbidden') throw Error('CACHE_UNAVAILABLE')
      if (!cached || cached.projectId !== projectId || cached.snapshot.dataEpoch !== current.dataEpoch) return null
      return structuredClone(cached)
    },
    /** Drop only the exact reviewed batch. Unknown in-flight results must be resolved first. */
    discardDrafts(expected: Pending[], preserve = false) {
      const frozen = structuredClone(expected)
      const task = edits.then(() => exclusive(`planner:${projectId}`, async () => {
        if (stopped) throw Error('EDITING_PAUSED')
        const pending = await storage.list(projectId)
        if (canonicalJson(pending) !== canonicalJson(frozen)) throw Error('DRAFTS_CHANGED')
        const confirmedEpoch = (await authorizedRead(() => readCurrent())).dataEpoch
        let alreadyCommitted = 0
        for (const item of pending) {
          const c = item.command, receipt = await authorizedRead(() => transport.queryReceipt(c))
          if (receipt) {
            if (receipt.projectId !== projectId || receipt.dataEpoch !== c.dataEpoch || receipt.operationId !== c.operationId || receipt.requestDigest !== await commandDigest(c)) throw new CommandError('OPERATION_ID_REUSED')
            alreadyCommitted++
          } else if (item.status === 'result_unknown' && c.dataEpoch === confirmedEpoch) throw Error('RESULT_STILL_UNKNOWN')
        }
        const current = await authorizedRead(() => readCurrent())
        if (stopped) throw Error('EDITING_PAUSED')
        if (preserve) {
          if (!storage.archiveBatch) throw Error('ARCHIVE_UNAVAILABLE')
          await storage.archiveBatch(projectId, frozen)
        } else await storage.removeBatch(projectId, frozen)
        const remaining = await storage.list(projectId)
        confirmed = remaining.length === 0
        publish({ snapshot: current, pending: remaining.length, status: confirmed ? 'synced' : 'resume_required', error: null })
        return { discarded: pending.length - alreadyCommitted, alreadyCommitted }
      }))
      // The panel reports failures; do not replace a known conflict with a generic network status.
      edits = task.catch(() => undefined)
      return task
    },
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
        // Count durable work even when reopening offline cannot revalidate access.
        const pending = await storage.list(projectId)
        publish({ pending: pending.length })
        const snapshot = await readCurrent()
        if (pending.some(item => item.command.dataEpoch !== snapshot.dataEpoch)) { publish({ snapshot, pending: pending.length, status: 'conflict', error: 'PROJECT_REPLACED' }); return }
        projectedDrafts = pending.length === 0
        confirmed = pending.length === 0
        publish({ snapshot, pending: pending.length, status: confirmed ? 'synced' : 'resume_required', error: null })
      } catch (error) { await failure(error) }
    },
    async resume() {
      const task = edits.then(async () => {
        // Recheck access before explicitly resuming denied drafts; never alter their frozen intent.
        const snapshot = await readCurrent()
        const pending = await storage.list(projectId)
        for (const item of pending) {
          approved.add(draftKey(item.command))
          if (item.status === 'forbidden') await storage.setStatus(projectId, item.command.dataEpoch, item.command.operationId, 'result_unknown')
        }
        projectedDrafts = pending.length === 0
        confirmed = true
        publish({ snapshot, pending: pending.length })
        await flush()
      })
      edits = task.catch(failure)
      return edits
    },
    /** Receipt lookup precedes current entity/epoch checks; this never sends or approves. */
    reconcileHandoff(input: Command) {
      const command = structuredClone(input)
      const task = edits.then(() => exclusive(`planner:${projectId}`, async () => {
        assertCommand(command)
        if (stopped || command.projectId !== projectId) throw new CommandError('FORBIDDEN')
        await authorizedRead(() => transport.read())
        const receipt = await authorizedRead(() => transport.queryReceipt(command))
        if (receipt && (receipt.projectId !== projectId || receipt.dataEpoch !== command.dataEpoch || receipt.operationId !== command.operationId || receipt.requestDigest !== await commandDigest(command))) throw new CommandError('OPERATION_ID_REUSED')
        const pending = await storage.get(projectId, command.dataEpoch, command.operationId)
        if (pending) assertSameRequest(pending.command, command)
        return receipt ? 'committed' as const : pending ? 'queued' as const : 'absent' as const
      }))
      edits = task.catch(() => {})
      return task
    },
    /** Payload and expected revisions are frozen before network I/O. */
    dispatch(type: string, payload: Json, expectedRevisions: Record<string, number>, dataEpoch = view.snapshot?.dataEpoch, operationId: string = crypto.randomUUID(), onLocalSave?: () => void) {
      const frozen = structuredClone({ type, payload, expectedRevisions })
      const task = edits.then(async () => {
        if (stopped || !confirmed || !view.snapshot || ['conflict', 'forbidden', 'failed'].includes(view.status)) throw new Error('EDITING_PAUSED')
        if (dataEpoch !== view.snapshot.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        if ((type === 'version.save' || type === 'version.restore') && (view.status !== 'synced' || view.pending)) throw new Error('EDITING_PAUSED')
        const snapshot = view.snapshot
        const command: Command = { projectId, dataEpoch: snapshot.dataEpoch, operationId, commandVersion: 1, ...frozen }
        transport.validateCommand?.(command)
        const projected = projectDraft(snapshot, command)
        publish({ status: 'saving_local', error: null })
        try { await box.prepare(command) } catch { publish({ status: 'local_error', error: 'LOCAL_SAVE_FAILED' }); return false }
        approved.add(draftKey(command))
        if (!projected.complete) projectedDrafts = false
        publish({ snapshot: projected.snapshot, status: 'local', pending: view.pending + 1 })
        // The UI may continue with a durable local entity while this request awaits cloud confirmation.
        onLocalSave?.()
        try { await flush() } catch (error) { await failure(error) }
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
            const unapproved = pending.some(item => !approved.has(draftKey(item.command)))
            if (!unapproved && confirmed && (view.status === 'unknown' || view.status === 'local')) {
              // Only this session's explicitly approved commands may resume automatically.
              // flush rechecks the shared queue under the project lock before any send.
              await flush()
            } else {
              // A paused queue must not pause access checks. Read only; never approve or
              // rewrite frozen commands, and do not keep a stale optimistic arrangement.
              const snapshot = await readCurrent()
              projectedDrafts = false
              if (unapproved) confirmed = false
              const replaced = pending.some(item => item.command.dataEpoch !== snapshot.dataEpoch)
              publish({ snapshot, pending: pending.length,
                status: replaced ? 'conflict' : unapproved ? 'resume_required' : view.status,
                error: replaced ? 'PROJECT_REPLACED' : unapproved ? null : view.error })
            }
            return
          }
          const snapshot = await readCurrent()
          confirmed = true
          publish({ snapshot, pending: 0, status: 'synced', error: null })
        } catch (error) { await failure(error) }
      })
      edits = task.catch(failure)
      return edits
    },
  }
}
