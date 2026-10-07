import { activityService } from './activityService.ts'
import { accessService } from './accessService.ts'
import { historyService } from './historyService.ts'
import { recycleService } from './recycleService.ts'
import { projectService } from './projectService.ts'
import { noteService } from './noteService.ts'
import { coreHandlers } from './coreHandlers.ts'
import { commandService } from './commandService.ts'
import type { Handler, TransactionStore } from './commandService.ts'
import { assertGatewayRequestSize, CommandError } from '../../src/fusion/protocol.ts'
import type { ProbeImages } from './probeImages.ts'

/** P1a only: allowlisted fictitious projects, no create/delete/admin database API. */
export function probeGateway(store: TransactionStore, projectIds: readonly string[], images?: ProbeImages) {
  const allowed = new Set(projectIds)
  const handlers = new Map<string, Handler>([
    ['probe.increment', { apply: data => {
      if (typeof data !== 'number' || !Number.isSafeInteger(data) || data >= 10000) throw new CommandError('INVALID_INPUT')
      return data + 1
    } }],
    ['probe.manage', { managementOnly: true, apply: data => data }],
  ])
  for (const [name, handler] of coreHandlers()) handlers.set(name, handler)
  const service = commandService(store, handlers)
  const notes = noteService(store)
  return async (event: unknown) => {
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new CommandError('INVALID_INPUT')
      assertGatewayRequestSize(event)
      const e = event as Record<string, unknown>
      if (e.action === 'project.create') return { ok: true, value: await projectService(store).create(e.request) }
      if (typeof e.projectId !== 'string' || (!allowed.has(e.projectId) && !/^fusion-created-[a-f0-9-]{36}$/.test(e.projectId))
        || typeof e.secret !== 'string' || !/^[a-f0-9]{64}$/.test(e.secret)) throw new CommandError('FORBIDDEN')
      if (typeof e.action === 'string' && ['image.upload', 'image.read', 'image.delete'].includes(e.action) && images) {
        await service.read(e.projectId, e.secret)
        const value = await images(e.action, e.projectId, e)
        // A revocation during storage I/O must prevent delivery of new content.
        await service.read(e.projectId, e.secret)
        return { ok: true, value }
      }
      if (e.action === 'activity.month' && typeof e.month === 'string') return { ok: true, value: await activityService(store).month(e.projectId, e.secret, e.month) }
      if (e.action === 'access.read') {
        if (e.candidateHash !== undefined && typeof e.candidateHash !== 'string') throw new CommandError('INVALID_INPUT')
        return { ok: true, value: await accessService(store).read(e.projectId, e.secret, e.candidateHash) }
      }
      if (e.action === 'history.list') {
        if (e.day !== undefined && e.day !== null && typeof e.day !== 'string') throw new CommandError('INVALID_INPUT')
        if (e.cursor !== undefined && e.cursor !== null && typeof e.cursor !== 'string') throw new CommandError('INVALID_INPUT')
        return { ok: true, value: await historyService(store).list(e.projectId, e.secret, e.cursor as string | null | undefined, e.day as string | null | undefined) }
      }
      if (e.action === 'history.read' && typeof e.id === 'string') return { ok: true, value: await historyService(store).read(e.projectId, e.secret, e.id) }
      if (e.action === 'recycle.list') return { ok: true, value: await recycleService(store).list(e.projectId, e.secret) }
      if (e.action === 'notes') return { ok: true, value: await notes.read(e.projectId, e.secret) }
      if (e.action === 'read') {
        const result = await notes.read(e.projectId, e.secret)
        const data = result.current.data
        return { ok: true, value: data && typeof data === 'object' && !Array.isArray(data) && data.schemaVersion === 2
          ? { ...result.current, role: result.role, notes: result.notes, notesRevision: result.notesRevision } : result.current }
      }
      if (e.action === 'execute') {
        if (!e.command || typeof e.command !== 'object'
          || (e.command as Record<string, unknown>).projectId !== e.projectId) throw new CommandError('FORBIDDEN')
        const type = (e.command as Record<string, unknown>).type
        if (type === 'access.rotateCollaboration') return { ok: true, value: await accessService(store).execute(e.command, e.secret) }
        return { ok: true, value: await ((type === 'version.save' || type === 'version.restore') ? historyService(store) : ['stayDate.remove', 'note.delete', 'guest.delete', 'table.deleteWithGuests', 'room.deleteWithAssignments', 'guest.clearRoom', 'guest.clearStayNeed', 'recycle.restore'].includes(String(type)) ? recycleService(store) : typeof type === 'string' && type.startsWith('note.') ? notes : service).execute(e.command, e.secret) }
      }
      if (e.action === 'receipt' && typeof e.dataEpoch === 'string' && e.dataEpoch.length > 0
        && typeof e.operationId === 'string' && e.operationId.length > 0) {
        return { ok: true, value: await service.queryReceipt(e.projectId, e.dataEpoch, e.operationId, e.secret) }
      }
      throw new CommandError('INVALID_INPUT')
    } catch (error) {
      // Neither request, secret, raw SDK error nor stack may reach response/logs.
      return { ok: false, error: { code: error instanceof CommandError ? error.code : 'INTERNAL_ERROR' } }
    }
  }
}
