import { describeActivity } from '../../src/fusion/activity.ts'
import { beforeBusinessWrite } from './dailySnapshots.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Command, Receipt } from '../../src/fusion/protocol.ts'
import { restoreCore } from '../../src/fusion/recycle.ts'
import type { CoreChange, RecycleRecord } from '../../src/fusion/recycle.ts'
import type { Core } from '../../src/fusion/core.ts'
import { assertCore } from './coreHandlers.ts'
import { authorize, hashSecret, businessDay } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'

function expected(c: Command, key: string, revision: number) {
  if (c.expectedRevisions[key] !== revision) throw new CommandError('CONFLICT')
}
function remove(core: Core, c: Command): CoreChange[] {
  const payload = c.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || typeof payload[c.type === 'stayDate.remove' ? 'date' : 'id'] !== 'string') throw new CommandError('INVALID_INPUT')
  const id = payload[c.type === 'stayDate.remove' ? 'date' : 'id'] as string
  const changes: CoreChange[] = []
  const recordGuest = (guestId: string, change: () => void) => {
    const before = structuredClone(core.guests[guestId]); expected(c, `guest:${guestId}`, before.revision)
    change(); core.guests[guestId].revision++
    changes.push({ section: 'guests', id: guestId, before, after: structuredClone(core.guests[guestId]) })
  }
  if (c.type === 'stayDate.remove') {
    if (!core.config.stayDates.includes(id)) throw new CommandError('NOT_FOUND')
    expected(c, 'config', core.config.revision)
    const affected = Object.values(core.guests).filter(g => g.stayDates.includes(id))
    if (canonicalJson(Object.keys(c.expectedRevisions).filter(k => k.startsWith('guest:')).sort()) !== canonicalJson(affected.map(g => `guest:${g.id}`).sort())) throw new CommandError('CONFLICT')
    const before = structuredClone(core.config)
    core.config.stayDates = core.config.stayDates.filter(date => date !== id); core.config.revision++
    changes.push({ section: 'config', id: 'stayDates', before, after: structuredClone(core.config) })
    for (const g of affected) recordGuest(g.id, () => { g.stayDates = g.stayDates.filter(date => date !== id) })
  } else if (c.type === 'guest.delete' || c.type === 'table.deleteWithGuests' || c.type === 'room.deleteWithAssignments') {
    const section = c.type === 'guest.delete' ? 'guests' : c.type === 'table.deleteWithGuests' ? 'tables' : 'rooms'
    const entities = core[section], entity = entities[id]
    if (!Object.hasOwn(entities, id)) throw new CommandError('NOT_FOUND')
    expected(c, `${section.slice(0, -1)}:${id}`, entity.revision)
    const affected = Object.values(core.guests).filter(g => section === 'tables' ? g.tableId === id : section === 'rooms' ? g.roomId === id : false)
    const expectedGuests = Object.keys(c.expectedRevisions).filter(key => key.startsWith('guest:')).sort()
    const actualGuests = (section === 'guests' ? [id] : affected.map(g => g.id)).map(id => `guest:${id}`).sort()
    if (canonicalJson(actualGuests) !== canonicalJson(expectedGuests)) throw new CommandError('CONFLICT')
    for (const g of affected) recordGuest(g.id, () => {
      if (section === 'tables') { g.tableId = null; g.seatIndex = null }
      else { g.roomId = null; g.stayDates = [] }
    })
    const orderKey = section === 'guests' ? 'guestOrder' : section === 'tables' ? 'tableOrder' : 'roomOrder'
    changes.push({ section, id, before: structuredClone(entity), after: null, position: core[orderKey].indexOf(id) })
    delete entities[id]; core[orderKey] = core[orderKey].filter(value => value !== id)
    core.retiredIds = [...new Set([...(core.retiredIds ?? []), `${section}:${id}`])]
  } else if (c.type === 'guest.clearRoom' || c.type === 'guest.clearStayNeed') {
    const g = core.guests[id]
    if (!Object.hasOwn(core.guests, id)) throw new CommandError('NOT_FOUND')
    if (!g.roomId) throw new CommandError('INVALID_INPUT')
    recordGuest(id, () => { g.roomId = null; g.stayDates = []; if (c.type === 'guest.clearStayNeed') g.stayNeed = 'not_needed' })
  } else throw new CommandError('INVALID_INPUT')
  return changes
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
          } else { changes = remove(core, c); assertCore(core) }
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
