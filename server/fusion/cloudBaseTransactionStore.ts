import { decodeActivity, incrementActivity } from '../../src/fusion/activity.ts'
import { assertProjectVersion, assertVersionMeta } from '../../src/fusion/history.ts'
import { assertRecycleRecord } from '../../src/fusion/recycle.ts'
import type { RecycleRecord } from '../../src/fusion/recycle.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import type cloudbase from '@cloudbase/node-sdk'
import type { Database as SDKDatabase } from '@cloudbase/node-sdk/types/db.js'
import { canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Receipt } from '../../src/fusion/protocol.ts'
import { hashSecret } from './commandService.ts'
import type { Access, Current, StoredReceipt, Transaction, TransactionStore } from './commandService.ts'

type Database = ReturnType<ReturnType<typeof cloudbase.init>['database']>
type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_CLOUD_DOCUMENT')
  return value as RecordValue
}
function response(value: unknown): RecordValue {
  const result = record(value)
  if (result.code) {
    // Preserve only machine code, never credential-bearing SDK messages.
    const error = new Error('CLOUDBASE_REQUEST_FAILED')
    Object.assign(error, { code: result.code })
    throw error
  }
  return result
}
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
function decodeAccess(value: unknown): Access {
  const v = record(value)
  if (typeof v.collaborationHash !== 'string' || typeof v.managementHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(v.collaborationHash) || !/^[a-f0-9]{64}$/.test(v.managementHash)) throw Error('INVALID_ACCESS_DOCUMENT')
  if (v.creationDigest !== undefined && (typeof v.creationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.creationDigest))) throw Error('INVALID_ACCESS_DOCUMENT')
  return { ...(v.creationDigest === undefined ? {} : { creationDigest: String(v.creationDigest) }), collaborationHash: v.collaborationHash, managementHash: v.managementHash }
}
function decodeCurrent(value: unknown): Current {
  const v = record(value)
  if (typeof v.dataEpoch !== 'string' || !v.dataEpoch || !nonnegative(v.snapshotRevision)) throw Error('INVALID_CURRENT_DOCUMENT')
  const data = JSON.parse(canonicalJson(v.data))
  return { dataEpoch: v.dataEpoch, snapshotRevision: v.snapshotRevision, data }
}
function decodeReceipt(value: unknown, projectId: string, epoch: string, operationId: string): StoredReceipt {
  const v = record(value), r = record(v.receipt)
  if (typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest)
    || (r.requestDigest !== undefined && r.requestDigest !== v.digest)
    || r.projectId !== projectId || r.dataEpoch !== epoch || r.operationId !== operationId
    || typeof r.committedAt !== 'string' || !Number.isFinite(Date.parse(r.committedAt))
    || !nonnegative(r.snapshotRevision)) throw Error('INVALID_RECEIPT_DOCUMENT')
  if (r.notesRevision !== undefined && !nonnegative(r.notesRevision)) throw Error('INVALID_RECEIPT_DOCUMENT')
  if (r.resultDataEpoch !== undefined && (typeof r.resultDataEpoch !== 'string' || !r.resultDataEpoch)) throw Error('INVALID_RECEIPT_DOCUMENT')
  const receipt: Receipt = { ...(r.resultDataEpoch === undefined ? {} : { resultDataEpoch: r.resultDataEpoch }), ...(r.notesRevision === undefined ? {} : { notesRevision: Number(r.notesRevision) }), requestDigest: v.digest, projectId, dataEpoch: epoch, operationId, committedAt: r.committedAt, snapshotRevision: r.snapshotRevision }
  return { digest: v.digest, receipt }
}

export const PROBE_COLLECTIONS = {
  access: 'planner_fusion_probe_access', current: 'planner_fusion_probe_current',
  receipts: 'planner_fusion_probe_receipts', activity: 'planner_fusion_probe_activity',
} as const
export const documentKey = (...parts: string[]) => hashSecret(canonicalJson(parts))

/** Isolated P1a collections only; never reads/writes the source project's weddings collection.
 * Keep operations inside a transaction sequential: live parallel reads fail with TransactionBusy.
 */
export function cloudBaseTransactionStore(db: Database): TransactionStore {
  return {
    async run<T>(projectId: string, body: (tx: Transaction) => Promise<T>): Promise<T> {
      return db.runTransaction(async (sdkTransaction: SDKDatabase.Transaction) => {
        const ref = (kind: keyof typeof PROBE_COLLECTIONS, parts: string[]) =>
          sdkTransaction.collection(PROBE_COLLECTIONS[kind]).doc(documentKey(projectId, ...parts))
        async function get(kind: keyof typeof PROBE_COLLECTIONS, parts: string[]): Promise<unknown | null> {
          const result = response(await ref(kind, parts).get())
          // Document get INSIDE node-sdk transaction returns one document or null.
          if (result.data === null) return null
          const doc = record(result.data)
          if (doc.projectId !== projectId || !Object.hasOwn(doc, 'payload')) throw Error('CLOUD_DOCUMENT_SCOPE_MISMATCH')
          return doc.payload
        }
        async function put(kind: keyof typeof PROBE_COLLECTIONS, parts: string[], payload: unknown) {
          response(await ref(kind, parts).set({ projectId, payload }))
        }
        return body({
          dailyState: async () => {
            const value = await get('current', ['daily-state'])
            if (value === null) return null
            const v = record(value)
            if (typeof v.businessDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.businessDate)
              || typeof v.lastCommittedAt !== 'string' || !Number.isFinite(Date.parse(v.lastCommittedAt)) || typeof v.sealed !== 'boolean') throw Error('INVALID_DAILY_STATE')
            if (v.failedAt !== undefined && (typeof v.failedAt !== 'string' || !Number.isFinite(Date.parse(v.failedAt)))) throw Error('INVALID_DAILY_STATE')
            return { businessDate: v.businessDate, lastCommittedAt: v.lastCommittedAt, sealed: v.sealed, ...(v.failedAt === undefined ? {} : { failedAt: v.failedAt as string }) }
          },
          putDailyState: value => put('current', ['daily-state'], { ...value, kind: 'daily-state' }),
          historyIndex: async () => {
            const value = await get('current', ['history-index'])
            if (value === null) return []
            if (!Array.isArray(value)) throw Error('INVALID_HISTORY_INDEX')
            value.forEach(assertVersionMeta)
            if (new Set(value.map(v => v.id)).size !== value.length) throw Error('INVALID_HISTORY_INDEX')
            return value as import('../../src/fusion/history.ts').VersionMeta[]
          },
          version: async id => {
            const value = await get('current', ['version', id])
            if (value === null) return null
            assertProjectVersion(value)
            if (value.id !== id) throw Error('VERSION_SCOPE_MISMATCH')
            return value
          },
          putHistoryIndex: value => put('current', ['history-index'], value),
          putVersion: value => put('current', ['version', value.id], value),
          recycleIndex: async epoch => {
            const v = await get('current', ['recycle-index', epoch])
            if (v === null) return []
            if (!Array.isArray(v) || v.some(x => typeof x !== 'string') || new Set(v).size !== v.length) throw Error('INVALID_RECYCLE_INDEX')
            return v
          },
          recycle: async (epoch, id) => {
            const v = await get('current', ['recycle', epoch, id])
            if (v === null) return null
            assertRecycleRecord(v)
            const r = v
            if (r.id !== id || r.dataEpoch !== epoch) throw Error('INVALID_RECYCLE_RECORD')
            return r as unknown as RecycleRecord
          },
          putRecycleIndex: (epoch, ids) => put('current', ['recycle-index', epoch], ids),
          putRecycle: (epoch, value) => put('current', ['recycle', epoch, value.id], value),
          putAccess: value => put('access', [], value),
          reserveCreation: async (day, limit) => {
            const quota = sdkTransaction.collection(PROBE_COLLECTIONS.access).doc(documentKey('__creation_quota__', day))
            const r = response(await quota.get())
            const doc = r.data === null ? null : record(r.data)
            if (doc && doc.projectId !== '__creation_quota__') throw Error('INVALID_CREATION_QUOTA')
            const count = doc ? record(doc.payload).count : 0
            if (!nonnegative(count)) throw Error('INVALID_CREATION_QUOTA')
            if (count >= limit) throw new CommandError('RATE_LIMITED')
            response(await quota.set({ projectId: '__creation_quota__', payload: { count: count + 1 } }))
          },
          noteIndex: async epoch => {
            const v = await get('current', ['notes', epoch])
            if (v === null) return null
            const index = record(v)
            if (!nonnegative(index.revision) || !Array.isArray(index.order) || index.order.some(x => typeof x !== 'string')
              || new Set(index.order).size !== index.order.length) throw Error('INVALID_NOTE_INDEX')
            if (index.retiredIds !== undefined && (!Array.isArray(index.retiredIds) || index.retiredIds.some(x => typeof x !== 'string') || new Set(index.retiredIds).size !== index.retiredIds.length)) throw Error('INVALID_NOTE_INDEX')
            return { revision: Number(index.revision), order: index.order as string[], ...(index.retiredIds === undefined ? {} : { retiredIds: index.retiredIds as string[] }) }
          },
          note: async (epoch, id) => {
            const v = await get('current', ['note', epoch, id])
            if (v === null) return null
            assertTextNote(v)
            if (v.id !== id) throw Error('NOTE_SCOPE_MISMATCH')
            return v
          },
          putNoteIndex: (epoch, value) => put('current', ['notes', epoch], value),
          removeNote: (epoch, id) => put('current', ['note', epoch, id], null),
          putNote: (epoch, value) => put('current', ['note', epoch, value.id], value),
          access: async () => { const v = await get('access', []); return v === null ? null : decodeAccess(v) },
          current: async () => { const v = await get('current', []); return v === null ? null : decodeCurrent(v) },
          receipt: async (epoch, operationId) => {
            const v = await get('receipts', [epoch, operationId])
            return v === null ? null : decodeReceipt(v, projectId, epoch, operationId)
          },
          putCurrent: value => put('current', [], value),
          putReceipt: (epoch, operationId, value) => put('receipts', [epoch, operationId], value),
          activity: async day => decodeActivity(day, await get('activity', [day])),
          incrementActivity: async (day, delta) => {
            const old = decodeActivity(day, await get('activity', [day]))
            await put('activity', [day], incrementActivity(old, delta))
          },
        })
      }, 2)
    },
  }
}
