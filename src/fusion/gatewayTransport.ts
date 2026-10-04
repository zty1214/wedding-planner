import { assertActivityMonth } from './activity.ts'
import { assertProjectVersion, assertVersionMeta } from './history.ts'
import { assertTextNote } from './notes.ts'
import { assertRecycleRecord } from './recycle.ts'
import { assertGatewayRequestSize, CommandError } from './protocol.ts'
import type { Command, ErrorCode, Receipt } from './protocol.ts'
import type { ProjectSnapshot, ProjectTransport } from './repository.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'

type Invoke = (event: Record<string, unknown>) => Promise<unknown>
const codes: ErrorCode[] = ['INVALID_INPUT', 'FORBIDDEN', 'CONFLICT', 'PROJECT_REPLACED', 'OPERATION_ID_REUSED', 'UPGRADE_REQUIRED', 'NOT_FOUND', 'SEAT_OCCUPIED', 'RATE_LIMITED', 'REQUEST_TOO_LARGE']
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_GATEWAY_RESPONSE')
  return value as Record<string, unknown>
}
function receipt(value: unknown, command: Command): Receipt {
  const r = record(value)
  if (r.projectId !== command.projectId || r.dataEpoch !== command.dataEpoch || r.operationId !== command.operationId
    || (r.resultDataEpoch !== undefined && (command.type !== 'version.restore' || typeof r.resultDataEpoch !== 'string' || !r.resultDataEpoch))
    || (command.type === 'version.restore' && typeof r.resultDataEpoch !== 'string')
    || typeof r.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.requestDigest)
    || typeof r.committedAt !== 'string' || !Number.isFinite(Date.parse(r.committedAt))
    || !Number.isSafeInteger(r.snapshotRevision) || Number(r.snapshotRevision) < 0) throw Error('INVALID_GATEWAY_RECEIPT')
  return r as unknown as Receipt
}
/** Secret stays in this closure; callers receive only business state and sanitized failures. */
export function gatewayTransport(projectId: string, secret: string, invoke: Invoke): ProjectTransport {
  async function call(action: string, extra: Record<string, unknown> = {}) {
    const envelope = record(await invoke({ action, projectId, secret, ...extra }))
    if (envelope.ok !== true) {
      const code = record(envelope.error).code
      if (typeof code === 'string' && codes.includes(code as ErrorCode)) throw new CommandError(code as ErrorCode)
      throw Error('GATEWAY_UNAVAILABLE')
    }
    return envelope.value
  }
  const scope = (command: Command) => { if (command.projectId !== projectId) throw new CommandError('FORBIDDEN') }
  return {
    validateCommand(command) { scope(command); assertGatewayRequestSize({ action: 'execute', projectId, secret, command }) },
    async readActivityMonth(month) {
      const value = await call('activity.month', { month }); assertActivityMonth(value)
      if (value.month !== month) throw Error('ACTIVITY_MONTH_MISMATCH')
      return value
    },
    async readHistory(cursor = null, day = null) {
      const value = record(await call('history.list', { cursor, day }))
      if (!Array.isArray(value.versions) || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) throw Error('INVALID_HISTORY_RESPONSE')
      value.versions.forEach(assertVersionMeta)
      return { versions: value.versions as import('./history.ts').VersionMeta[], nextCursor: value.nextCursor as string | null }
    },
    async readVersion(id) {
      const value = await call('history.read', { id }); assertProjectVersion(value)
      if (value.id !== id) throw Error('VERSION_SCOPE_MISMATCH')
      return value
    },
    async readRecycle() {
      const result = record(await call('recycle.list'))
      if (typeof result.dataEpoch !== 'string' || !result.dataEpoch || !Array.isArray(result.records)) throw Error('INVALID_RECYCLE_RESPONSE')
      result.records.forEach(assertRecycleRecord)
      const records = result.records as import('./recycle.ts').RecycleRecord[]
      if (new Set(records.map(r => JSON.stringify([r.dataEpoch, r.id]))).size !== records.length) throw Error('INVALID_RECYCLE_RESPONSE')
      return { dataEpoch: result.dataEpoch, records }
    },
    async read(): Promise<ProjectSnapshot> {
      const current = record(await call('read'))
      if (typeof current.dataEpoch !== 'string' || !current.dataEpoch || !Number.isSafeInteger(current.snapshotRevision)
        || Number(current.snapshotRevision) < 0) throw Error('INVALID_GATEWAY_SNAPSHOT')
      if (current.role !== undefined && !['management', 'collaboration'].includes(String(current.role))) throw Error('INVALID_ROLE')
      assertCore(current.data)
      if (current.notes !== undefined) {
        if (!Array.isArray(current.notes) || !Number.isSafeInteger(current.notesRevision) || Number(current.notesRevision) < 0) throw Error('INVALID_NOTES_RESPONSE')
        current.notes.forEach(assertTextNote)
      }
      return { ...(current.role === undefined ? {} : { role: current.role as 'management' | 'collaboration' }), dataEpoch: current.dataEpoch, snapshotRevision: Number(current.snapshotRevision), data: current.data, ...(current.notes === undefined ? {} : { notes: current.notes as import('./notes.ts').TextNote[], notesRevision: Number(current.notesRevision) }) }
    },
    async execute(command) { scope(command); return receipt(await call('execute', { command }), command) },
    async queryReceipt(command) {
      scope(command)
      const value = await call('receipt', { dataEpoch: command.dataEpoch, operationId: command.operationId })
      return value === null ? null : receipt(value, command)
    },
  }
}
