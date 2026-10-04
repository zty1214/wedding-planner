import type { Current, Transaction, TransactionStore } from './commandService.ts'
import { assertCore } from './coreHandlers.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { assertProjectVersion } from '../../src/fusion/history.ts'
import type { ProjectVersion, VersionMeta } from '../../src/fusion/history.ts'
import { businessDay } from './businessTime.ts'
export type DailyState = { businessDate: string; lastCommittedAt: string; sealed: boolean; failedAt?: string }

/** Same transaction as the next business write: capture yesterday before any data changes. */
export async function sealPreviousDay(tx: Transaction, current: Current, date: Date) {
  const state = await tx.dailyState(), today = businessDay(date)
  if (!state || state.sealed || state.businessDate === today) return
  if (state.businessDate > today) throw Error('SERVER_CLOCK_REGRESSED')
  assertCore(current.data)
  const index = await tx.noteIndex(current.dataEpoch) ?? { revision: 0, order: [] }
  const notes = []
  for (const id of index.order) {
    const note = await tx.note(current.dataEpoch, id)
    if (!note) throw Error('NOTE_INDEX_INCOMPLETE')
    assertTextNote(note); notes.push(note)
  }
  const meta: VersionMeta = { id: `daily:${state.businessDate}`, name: `${state.businessDate} 自动快照`, kind: 'daily', status: 'ready',
    dataEpoch: current.dataEpoch, snapshotRevision: current.snapshotRevision, notesRevision: index.revision,
    businessDate: state.businessDate, capturedAt: date.toISOString(), lastBusinessCommittedAt: state.lastCommittedAt,
    expiresAt: new Date(date.getTime() + 90 * 86400000).toISOString(),
    counts: { guests: current.data.guestOrder.length, tables: current.data.tableOrder.length, rooms: current.data.roomOrder.length, notes: notes.length } }
  const version: ProjectVersion = { ...meta, schemaVersion: 1, core: structuredClone(current.data), notes, noteRetiredIds: index.retiredIds ?? [] }
  assertProjectVersion(version)
  if (await tx.version(meta.id)) throw Error('DAILY_VERSION_ALREADY_EXISTS_WITH_UNSEALED_STATE')
  const history = await tx.historyIndex()
  await tx.putVersion(version); await tx.putHistoryIndex([meta, ...history])
  await tx.putDailyState({ businessDate: state.businessDate, lastCommittedAt: state.lastCommittedAt, sealed: true })
}
export async function beforeBusinessWrite(tx: Transaction, current: Current, date: Date) {
  // Legacy numeric fixtures exercise only transactions and have no business snapshot schema.
  if (!current.data || typeof current.data !== 'object' || Array.isArray(current.data) || current.data.schemaVersion !== 2) return
  await sealPreviousDay(tx, current, date)
  const state = await tx.dailyState()
  if (state && state.businessDate > businessDay(date)) throw Error('SERVER_CLOCK_REGRESSED')
  await tx.putDailyState({ businessDate: businessDay(date), lastCommittedAt: date.toISOString(), sealed: false })
}
/** Trusted scheduler entry; caller must select an isolated project, not accept a client-supplied clock. */
export async function closeDailyProject(store: TransactionStore, projectId: string, now = () => new Date()) {
  let attemptedDay: string | undefined, attemptedCommit: string | undefined
  try { return await store.run(projectId, async tx => {
    const current = await tx.current()
    if (!current) return
    const attempt = await tx.dailyState()
    attemptedDay = attempt?.businessDate; attemptedCommit = attempt?.lastCommittedAt
    await sealPreviousDay(tx, current, now())
  }) } catch (error) {
    // Failure state is separate from the aborted snapshot transaction; never mark a later day or completed snapshot failed.
    try { await store.run(projectId, async tx => {
      const state = await tx.dailyState(), date = now()
      if (state && !state.sealed && state.businessDate === attemptedDay && state.lastCommittedAt === attemptedCommit && state.businessDate < businessDay(date)) await tx.putDailyState({ ...state, failedAt: date.toISOString() })
    }) } catch { /* Preserve original failure; unavailable storage cannot prove a persisted failure marker. */ }
    throw error
  }
}
