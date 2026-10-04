import { describeActivity } from '../../src/fusion/activity.ts'
import { beforeBusinessWrite } from './dailySnapshots.ts'
import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Receipt } from '../../src/fusion/protocol.ts'
import { assertTextNote, editTextNote } from '../../src/fusion/notes.ts'
import type { TextNote, NoteSnapshot } from '../../src/fusion/notes.ts'
import { authorize, businessDay, hashSecret } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'

export function noteService(store: TransactionStore, now = () => new Date()) {
  return {
    async read(projectId: string, secret: string): Promise<NoteSnapshot & { current: import('./commandService.ts').Current; role: 'management' | 'collaboration' }> {
      return store.run(projectId, async tx => {
        const role = authorize(await tx.access(), secret)
        const current = await tx.current()
        if (!current) throw new CommandError('NOT_FOUND')
        const index = await tx.noteIndex(current.dataEpoch) ?? { revision: 0, order: [] }
        const notes: TextNote[] = []
        for (const id of index.order) {
          const note = await tx.note(current.dataEpoch, id)
          if (!note) throw Error('NOTE_INDEX_INCOMPLETE')
          assertTextNote(note); notes.push(note)
        }
        return { current, role, dataEpoch: current.dataEpoch, notesRevision: index.revision, notes }
      })
    },
    async execute(input: unknown, secret: string): Promise<Receipt> {
      assertCommand(input)
      const c = structuredClone(input)
      if (!['note.add', 'note.update'].includes(c.type) || !c.payload || Array.isArray(c.payload) || typeof c.payload !== 'object') throw new CommandError('INVALID_INPUT')
      const p = c.payload
      const fields = ['id', 'category', 'title', 'content']
      if (Object.keys(p).length !== fields.length || fields.some(k => typeof p[k] !== 'string')) throw new CommandError('INVALID_INPUT')
      const id = p.id as string, digest = hashSecret(canonicalJson(c))
      return store.run(c.projectId, async tx => {
        authorize(await tx.access(), secret)
        const current = await tx.current()
        if (!current || current.dataEpoch !== c.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        const previous = await tx.receipt(c.dataEpoch, c.operationId)
        if (previous) {
          if (previous.digest !== digest) throw new CommandError('OPERATION_ID_REUSED')
          return previous.receipt
        }
        const old = await tx.note(c.dataEpoch, id), index = await tx.noteIndex(c.dataEpoch) ?? { revision: 0, order: [] }
        if (c.type === 'note.add' && (old || index.retiredIds?.includes(id))) throw new CommandError('CONFLICT')
        if (c.type === 'note.update' && !old) throw new CommandError('NOT_FOUND')
        if (old && c.expectedRevisions[`note:${id}`] !== old.revision) throw new CommandError('CONFLICT')
        if (old && !index.order.includes(id)) throw Error('NOTE_INDEX_INCOMPLETE')
        const changed = !old || old.category !== p.category || old.title !== p.title || old.content !== p.content
        const date = now(), timestamp = date.toISOString()
        const note = editTextNote(old, p, timestamp)
        const receipt: Receipt = { projectId: c.projectId, dataEpoch: c.dataEpoch, operationId: c.operationId, requestDigest: digest,
          snapshotRevision: current.snapshotRevision, notesRevision: index.revision + Number(changed), committedAt: timestamp }
        if (changed) {
          await beforeBusinessWrite(tx, current, date)
          await tx.putNote(c.dataEpoch, note)
          await tx.putNoteIndex(c.dataEpoch, { ...index, revision: receipt.notesRevision!, order: old ? index.order : [id, ...index.order] })
          await tx.incrementActivity(businessDay(date), describeActivity(c))
        }
        await tx.putReceipt(c.dataEpoch, c.operationId, { digest, receipt })
        return receipt
      })
    },
  }
}
