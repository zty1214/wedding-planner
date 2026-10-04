import { decodeActivity, incrementActivity } from '../../src/fusion/activity.ts'
import type { ActivityDay } from '../../src/fusion/activity.ts'
import type { DailyState } from '../../server/fusion/dailySnapshots.ts'
import type { ProjectVersion, VersionMeta } from '../../src/fusion/history.ts'
import type { RecycleRecord } from '../../src/fusion/recycle.ts'
import { CommandError } from '../../src/fusion/protocol.ts'
import type { TextNote, NoteIndex } from '../../src/fusion/notes.ts'
import type { Access, Current, StoredReceipt, Transaction, TransactionStore } from '../../server/fusion/commandService.ts'
interface Project { activityDetails: Map<string, ActivityDay>; daily: DailyState | null; versions: Map<string, ProjectVersion>; history: VersionMeta[]; recycled: Map<string, RecycleRecord>; recycleIndexes: Map<string, string[]>; notes: Map<string, TextNote>; noteIndexes: Map<string, NoteIndex>; access: Access; current: Current; receipts: Map<string, StoredReceipt>; activity: Map<string, number> }
/** Test double only. Serialization here does not prove CloudBase transactions. */
export class MemoryStore implements TransactionStore {
  projects = new Map<string, Project>()
  failReceipt = false
  creationCounts = new Map<string, number>()
  private tail: Promise<unknown> = Promise.resolve()
  seed(id: string, access: Access, current: Current) {
    this.projects.set(id, { daily: null, versions: new Map(), history: [], recycled: new Map(), recycleIndexes: new Map(), notes: new Map(), noteIndexes: new Map(), access, current, receipts: new Map(), activity: new Map(), activityDetails: new Map() })
  }
  run<T>(id: string, body: (tx: Transaction) => Promise<T>): Promise<T> {
    const attempt = this.tail.then(async () => {
      const original = this.projects.get(id)
      const copy = structuredClone(original) ?? { access: null, current: null, daily: null, versions: new Map(), history: [], recycled: new Map(), recycleIndexes: new Map(), notes: new Map(), noteIndexes: new Map(), receipts: new Map(), activity: new Map(), activityDetails: new Map() }
      const counts = new Map(this.creationCounts)
      const tx: Transaction = {
        dailyState: async () => copy.daily,
        putDailyState: async value => { copy.daily = value },
        historyIndex: async () => copy.history,
        version: async id => copy.versions.get(id) ?? null,
        putHistoryIndex: async value => { copy.history = value },
        putVersion: async value => { copy.versions.set(value.id, value) },
        recycleIndex: async epoch => copy.recycleIndexes.get(epoch) ?? [],
        recycle: async (epoch, id) => copy.recycled.get(JSON.stringify([epoch, id])) ?? null,
        putRecycleIndex: async (epoch, ids) => { copy.recycleIndexes.set(epoch, ids) },
        putRecycle: async (epoch, value) => { copy.recycled.set(JSON.stringify([epoch, value.id]), value) },
        putAccess: async value => { copy.access = value },
        reserveCreation: async (day, limit) => {
          const count = counts.get(day) ?? 0
          if (count >= limit) throw new CommandError('RATE_LIMITED')
          counts.set(day, count + 1)
        },
        noteIndex: async epoch => copy?.noteIndexes.get(epoch) ?? null,
        note: async (epoch, id) => copy?.notes.get(JSON.stringify([epoch, id])) ?? null,
        putNoteIndex: async (epoch, value) => { if (!copy) throw Error('MISSING'); copy.noteIndexes.set(epoch, value) },
        removeNote: async (epoch, id) => { copy.notes.delete(JSON.stringify([epoch, id])) },
        putNote: async (epoch, value) => { if (!copy) throw Error('MISSING'); copy.notes.set(JSON.stringify([epoch, value.id]), value) },
        access: async () => copy?.access ?? null,
        current: async () => copy?.current ?? null,
        receipt: async (epoch, op) => copy?.receipts.get(JSON.stringify([epoch, op])) ?? null,
        putCurrent: async value => { if (!copy) throw Error('MISSING'); copy.current = value },
        putReceipt: async (epoch, op, value) => {
          if (this.failReceipt || !copy) throw Error('INJECTED_FAILURE')
          copy.receipts.set(JSON.stringify([epoch, op]), value)
        },
        activity: async day => copy.activityDetails.get(day) ?? decodeActivity(day, { day, count: copy.activity.get(day) ?? 0 }),
        incrementActivity: async (day, delta) => {
          const next = incrementActivity(copy.activityDetails.get(day) ?? decodeActivity(day, { day, count: copy.activity.get(day) ?? 0 }), delta)
          copy.activityDetails.set(day, next); copy.activity.set(day, next.count)
        },
      }
      const result = await body(tx)
      if (copy.access && copy.current) this.projects.set(id, { ...copy, access: copy.access, current: copy.current })
      this.creationCounts = counts
      return structuredClone(result)
    })
    this.tail = attempt.catch(() => undefined)
    return attempt
  }
}
