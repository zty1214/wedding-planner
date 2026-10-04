import { monthDays, describeActivity } from '../../src/fusion/activity.ts'
import { beforeBusinessWrite } from './dailySnapshots.ts'
import { randomUUID } from 'node:crypto'
import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Receipt } from '../../src/fusion/protocol.ts'
import { assertProjectVersion } from '../../src/fusion/history.ts'
import type { ProjectVersion, VersionMeta } from '../../src/fusion/history.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { assertCore } from './coreHandlers.ts'
import { authorize, businessDay, hashSecret } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'

export function historyService(store: TransactionStore, now = () => new Date()) {
  return {
    async list(projectId: string, secret: string, cursor: string | null = null, day: string | null = null) {
      if (day !== null && !monthDays(day.slice(0, 7)).includes(day)) throw new CommandError('INVALID_INPUT')
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        const index = (await tx.historyIndex()).filter(v => day === null || v.businessDate === day)
        const start = cursor === null ? 0 : index.findIndex(v => v.id === cursor) + 1
        if (cursor !== null && start === 0) throw new CommandError('INVALID_INPUT')
        const versions = index.slice(start, start + 20)
        return { versions, nextCursor: start + versions.length < index.length ? versions.at(-1)!.id : null }
      })
    },
    async read(projectId: string, secret: string, id: string) {
      return store.run(projectId, async tx => {
        authorize(await tx.access(), secret)
        const version = await tx.version(id)
        if (!version) throw new CommandError('NOT_FOUND')
        assertProjectVersion(version)
        return version
      })
    },
    async execute(input: unknown, secret: string): Promise<Receipt> {
      assertCommand(input)
      const c = structuredClone(input), p = c.payload
      const restoring = c.type === 'version.restore'
      const field = restoring ? 'id' : 'name'
      if ((!restoring && c.type !== 'version.save') || !p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 1
        || typeof p[field] !== 'string' || !(p[field] as string).trim() || (!restoring && (p[field] as string).trim().length > 100)) throw new CommandError('INVALID_INPUT')
      const value = (p[field] as string).trim()
      const digest = hashSecret(canonicalJson(c))
      return store.run(c.projectId, async tx => {
        const role = authorize(await tx.access(), secret)
        if (restoring && role !== 'management') throw new CommandError('FORBIDDEN')
        const old = await tx.receipt(c.dataEpoch, c.operationId)
        if (old) { if (old.digest !== digest) throw new CommandError('OPERATION_ID_REUSED'); return old.receipt }
        const current = await tx.current()
        if (!current || current.dataEpoch !== c.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        assertCore(current.data)
        const index = await tx.noteIndex(c.dataEpoch) ?? { revision: 0, order: [] }
        if (c.expectedRevisions.snapshot !== current.snapshotRevision || c.expectedRevisions.notes !== index.revision) throw new CommandError('CONFLICT')
        const notes = []
        for (const id of index.order) {
          const note = await tx.note(c.dataEpoch, id)
          if (!note) throw Error('NOTE_INDEX_INCOMPLETE')
          assertTextNote(note); notes.push(note)
        }
        const date = now()
        if (restoring) await beforeBusinessWrite(tx, current, date)
        const meta: VersionMeta = { id: `${c.dataEpoch}:${c.operationId}${restoring ? ':safety' : ''}`, name: restoring ? '整项目恢复前的安全版本' : value, kind: restoring ? 'safety' : 'manual', status: 'ready',
          dataEpoch: c.dataEpoch, snapshotRevision: current.snapshotRevision, notesRevision: index.revision,
          capturedAt: date.toISOString(), businessDate: businessDay(date), expiresAt: restoring ? new Date(date.getTime() + 90 * 86400000).toISOString() : null,
          counts: { guests: current.data.guestOrder.length, tables: current.data.tableOrder.length, rooms: current.data.roomOrder.length, notes: notes.length } }
        const version: ProjectVersion = { ...meta, schemaVersion: 1, core: structuredClone(current.data), notes, noteRetiredIds: index.retiredIds ?? [] }
        assertProjectVersion(version)
        if (await tx.version(meta.id)) throw new CommandError('CONFLICT')
        const history = await tx.historyIndex()
        await tx.putVersion(version); await tx.putHistoryIndex([meta, ...history])
        const receipt: Receipt = { projectId: c.projectId, dataEpoch: c.dataEpoch, operationId: c.operationId, requestDigest: digest,
          snapshotRevision: current.snapshotRevision, notesRevision: index.revision, committedAt: date.toISOString() }
        if (restoring) {
          const target = await tx.version(value)
          if (!target) throw new CommandError('NOT_FOUND')
          assertProjectVersion(target)
          if (target.expiresAt && Date.parse(target.expiresAt) <= date.getTime()) throw new CommandError('CONFLICT')
          const dataEpoch = randomUUID()
          for (const note of target.notes) await tx.putNote(dataEpoch, structuredClone(note))
          await tx.putNoteIndex(dataEpoch, { revision: index.revision + 1, order: target.notes.map(n => n.id), retiredIds: [...target.noteRetiredIds] })
          await tx.putCurrent({ dataEpoch, snapshotRevision: current.snapshotRevision + 1, data: structuredClone(target.core) })
          receipt.resultDataEpoch = dataEpoch
          receipt.snapshotRevision = current.snapshotRevision + 1
          receipt.notesRevision = index.revision + 1
          await tx.incrementActivity(businessDay(date), describeActivity(c, current.data, target.core))
        }
        await tx.putReceipt(c.dataEpoch, c.operationId, { digest, receipt })
        return receipt
      })
    },
  }
}
