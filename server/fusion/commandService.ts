import { describeActivity } from '../../src/fusion/activity.ts'
import type { ActivityDay, ActivityDelta } from '../../src/fusion/activity.ts'
import { beforeBusinessWrite } from './dailySnapshots.ts'
import type { DailyState } from './dailySnapshots.ts'
import { businessDay } from './businessTime.ts'
export { businessDay } from './businessTime.ts'
import type { ProjectVersion, VersionMeta } from '../../src/fusion/history.ts'
import type { RecycleRecord } from '../../src/fusion/recycle.ts'
import type { TextNote, NoteIndex } from '../../src/fusion/notes.ts'
import { createHash, timingSafeEqual } from 'node:crypto'
import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Json, Receipt } from '../../src/fusion/protocol.ts'

export interface Access { creationDigest?: string; collaborationHash: string; managementHash: string }
export interface Current { dataEpoch: string; snapshotRevision: number; data: Json }
export interface StoredReceipt { digest: string; receipt: Receipt }
export interface Transaction {
  dailyState(): Promise<DailyState | null>
  putDailyState(value: DailyState): Promise<void>
  historyIndex(): Promise<VersionMeta[]>
  version(id: string): Promise<ProjectVersion | null>
  putHistoryIndex(value: VersionMeta[]): Promise<void>
  putVersion(value: ProjectVersion): Promise<void>
  recycleIndex(epoch: string): Promise<string[]>
  recycle(epoch: string, id: string): Promise<RecycleRecord | null>
  putRecycleIndex(epoch: string, ids: string[]): Promise<void>
  putRecycle(epoch: string, value: RecycleRecord): Promise<void>
  putAccess(value: Access): Promise<void>
  reserveCreation(day: string, limit: number): Promise<void>
  noteIndex(epoch: string): Promise<NoteIndex | null>
  note(epoch: string, id: string): Promise<TextNote | null>
  putNoteIndex(epoch: string, value: NoteIndex): Promise<void>
  removeNote(epoch: string, id: string): Promise<void>
  putNote(epoch: string, value: TextNote): Promise<void>
  access(): Promise<Access | null>
  current(): Promise<Current | null>
  receipt(epoch: string, operationId: string): Promise<StoredReceipt | null>
  putCurrent(value: Current): Promise<void>
  putReceipt(epoch: string, operationId: string, value: StoredReceipt): Promise<void>
  activity(day: string): Promise<ActivityDay>
  incrementActivity(day: string, delta: ActivityDelta): Promise<void>
}
/** Adapter MUST provide serializable transactions and roll back all writes on failure. */
export interface TransactionStore {
  run<T>(projectId: string, body: (tx: Transaction) => Promise<T>): Promise<T>
}
export type { CommandHandler as Handler } from '../../src/fusion/protocol.ts'
import type { CommandHandler as Handler } from '../../src/fusion/protocol.ts'
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex')
function matches(secret: string, hash: string) {
  const actual = Buffer.from(hashSecret(secret), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function authorize(access: Access | null, secret: string): 'management' | 'collaboration' {
  if (!access || typeof secret !== 'string' || !secret) throw new CommandError('FORBIDDEN')
  if (matches(secret, access.managementHash)) return 'management'
  if (matches(secret, access.collaborationHash)) return 'collaboration'
  throw new CommandError('FORBIDDEN')
}
/** P1 transaction probe: destructive commands and day rollover must be added before production use. */
export function commandService(store: TransactionStore, handlers: ReadonlyMap<string, Handler>, now = () => new Date()) {
  return {
    async read(projectId: string, secret: string): Promise<Current | null> {
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        return tx.current()
      })
    },
    async execute(input: unknown, secret: string): Promise<Receipt> {
      assertCommand(input)
      const command = structuredClone(input)
      const handler = handlers.get(command.type)
      if (!handler) throw new CommandError('INVALID_INPUT')
      const digest = hashSecret(canonicalJson(command))
      return store.run(command.projectId, async tx => {
        const role = authorize(await tx.access(), secret)
        if (handler.managementOnly && role !== 'management') throw new CommandError('FORBIDDEN')
        const current = await tx.current()
        if (!current || current.dataEpoch !== command.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        const previous = await tx.receipt(command.dataEpoch, command.operationId)
        if (previous) {
          if (previous.digest !== digest) throw new CommandError('OPERATION_ID_REUSED')
          return previous.receipt
        }
        const next = handler.apply(structuredClone(current.data), command)
        const changed = canonicalJson(next) !== canonicalJson(current.data)
        const committedAt = now()
        const receipt: Receipt = {
          requestDigest: digest,
          projectId: command.projectId, dataEpoch: command.dataEpoch, operationId: command.operationId,
          snapshotRevision: current.snapshotRevision + Number(changed), committedAt: committedAt.toISOString(),
        }
        if (changed) {
          await beforeBusinessWrite(tx, current, committedAt)
          await tx.putCurrent({ ...current, data: next, snapshotRevision: receipt.snapshotRevision })
          await tx.incrementActivity(businessDay(committedAt), describeActivity(command, current.data, next))
        }
        await tx.putReceipt(command.dataEpoch, command.operationId, { digest, receipt })
        return receipt
      })
    },
    async queryReceipt(projectId: string, epoch: string, operationId: string, secret: string) {
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        // Old epochs are queryable; execute never replays them.
        return (await tx.receipt(epoch, operationId))?.receipt ?? null
      })
    },
  }
}
