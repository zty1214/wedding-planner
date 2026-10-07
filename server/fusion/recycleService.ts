import { describeActivity } from '../../src/fusion/activity.ts'
import { beforeBusinessWrite } from './dailySnapshots.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Command, Receipt } from '../../src/fusion/protocol.ts'
import { restoreCore } from '../../src/fusion/recycle.ts'
import type { CoreChange, RecycleRecord } from '../../src/fusion/recycle.ts'
import { removeCore } from '../../src/fusion/removeCore.ts'
import { assertCore } from './coreHandlers.ts'
import { authorize, hashSecret, businessDay } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'

function expected(c: Command, key: string, revision: number) {
  if (c.expectedRevisions[key] !== revision) throw new CommandError('CONFLICT')
}
export function recycleService(store: TransactionStore, now = () => new Date()) {
  return {
    async list(projectId: string, secret: string) {
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        const current = await tx.current(); if (!current) throw new CommandError('NOT_FOUND')
        const records: RecycleRecord[] = []
        const epochs = new Set([current.dataEpoch, ...(await tx.historyIndex()).map(v => v.dataEpoch)])
        for (const epoch of epochs) for (const id of await tx.recycleIndex(epoch)) {
          const r = await tx.recycle(epoch, id)
          if (!r) throw Error('RECYCLE_INDEX_INCOMPLETE')
          if (!r.restoredAt && Date.parse(r.expiresAt) > now().getTime()) records.push(r)
        }
        return { dataEpoch: current.dataEpoch, records }
      })
    },
    async execute(input: unknown, secret: string): Promise<Receipt> {
      assertCommand(input); const c = structuredClone(input), digest = hashSecret(canonicalJson(c))
      return store.run(c.projectId, async tx => {
        authorize(await tx.access(), secret)
        const current = await tx.current()
        if (!current || current.dataEpoch !== c.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        const previous = await tx.receipt(c.dataEpoch, c.operationId)
        if (previous) { if (previous.digest !== digest) throw new CommandError('OPERATION_ID_REUSED'); return previous.receipt }
        let restoredType: string | undefined
        let notesRevision: number | undefined
        assertCore(current.data); const core = structuredClone(current.data), time = now(), timestamp = time.toISOString()
        await beforeBusinessWrite(tx, current, time)
        if (c.type === 'recycle.restore') {
          const p = c.payload
          if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1 || typeof p.id !== 'string') throw new CommandError('INVALID_INPUT')
          const r = await tx.recycle(c.dataEpoch, p.id)
          if (!r || r.restoredAt || Date.parse(r.expiresAt) <= time.getTime()) throw new CommandError('CONFLICT')
          restoredType = r.type
          if (r.type === 'note.delete') {
            const change = r.changes[0]
            if (r.changes.length !== 1 || change.section !== 'notes') throw new CommandError('INVALID_INPUT')
            const note = structuredClone(change.before); assertTextNote(note)
            const index = await tx.noteIndex(c.dataEpoch)
            if (!index || index.order.includes(note.id) || await tx.note(c.dataEpoch, note.id)) throw new CommandError('CONFLICT')
            note.revision++; note.updatedAt = timestamp; assertTextNote(note)
            const order = [...index.order]; order.splice(Math.min(change.position ?? order.length, order.length), 0, note.id)
            notesRevision = index.revision + 1
            await tx.putNote(c.dataEpoch, note)
            await tx.putNoteIndex(c.dataEpoch, { ...index, revision: notesRevision, order })
          } else restoreCore(core, r.changes, c)
          await tx.putRecycle(c.dataEpoch, { ...r, restoredAt: timestamp })
        } else {
          let changes: CoreChange[]
          if (c.type === 'note.delete') {
            const p = c.payload
            if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1 || typeof p.id !== 'string') throw new CommandError('INVALID_INPUT')
            const note = await tx.note(c.dataEpoch, p.id), index = await tx.noteIndex(c.dataEpoch)
            if (!note) throw new CommandError('NOT_FOUND')
            assertTextNote(note); expected(c, `note:${p.id}`, note.revision)
            if (!index || !index.order.includes(p.id)) throw Error('NOTE_INDEX_INCOMPLETE')
            changes = [{ section: 'notes', id: p.id, before: note, after: null, position: index.order.indexOf(p.id) }]
            notesRevision = index.revision + 1
            await tx.removeNote(c.dataEpoch, p.id)
            await tx.putNoteIndex(c.dataEpoch, { ...index, revision: notesRevision, order: index.order.filter(id => id !== p.id), retiredIds: [...new Set([...(index.retiredIds ?? []), p.id])] })
          } else { changes = removeCore(core, c); assertCore(core) }
          await tx.putRecycle(c.dataEpoch, { id: c.operationId, dataEpoch: c.dataEpoch, type: c.type, changes,
            createdAt: timestamp, expiresAt: new Date(time.getTime() + 30 * 86400000).toISOString(), restoredAt: null })
          const ids = await tx.recycleIndex(c.dataEpoch); await tx.putRecycleIndex(c.dataEpoch, [c.operationId, ...ids])
        }
        const receipt: Receipt = { projectId: c.projectId, dataEpoch: c.dataEpoch, operationId: c.operationId, requestDigest: digest, committedAt: timestamp, snapshotRevision: current.snapshotRevision + Number(notesRevision === undefined), ...(notesRevision === undefined ? {} : { notesRevision }) }
        if (notesRevision === undefined) await tx.putCurrent({ ...current, data: core, snapshotRevision: receipt.snapshotRevision })
        await tx.incrementActivity(businessDay(time), describeActivity(c, current.data, core, restoredType)); await tx.putReceipt(c.dataEpoch, c.operationId, { digest, receipt })
        return receipt
      })
    },
  }
}
