/** Transport contracts for the P1 probe. Not yet connected to production pages. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface Command {
  projectId: string
  dataEpoch: string
  operationId: string
  commandVersion: 1
  type: string
  payload: Json
  expectedRevisions: Record<string, number>
}
export interface Receipt {
  resultDataEpoch?: string
  notesRevision?: number
  requestDigest: string
  projectId: string
  dataEpoch: string
  operationId: string
  committedAt: string
  snapshotRevision: number
}
export type ErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'CONFLICT' | 'PROJECT_REPLACED'
  | 'OPERATION_ID_REUSED' | 'UPGRADE_REQUIRED' | 'NOT_FOUND' | 'SEAT_OCCUPIED' | 'RATE_LIMITED' | 'REQUEST_TOO_LARGE'
export class CommandError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode) {
    super(code)
    this.name = 'CommandError'
    this.code = code
  }
}

/** Stable digest input; reject values which JSON.stringify would silently discard. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + Array.from(value, canonicalJson).join(',') + ']'
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(Reflect.get(value, key))).join(',') + '}'
  }
  throw new CommandError('INVALID_INPUT')
}

export function assertCommand(value: unknown): asserts value is Command {
  if (!value || typeof value !== 'object') throw new CommandError('INVALID_INPUT')
  const c = value as Record<string, unknown>
  const fields = ['projectId', 'dataEpoch', 'operationId', 'commandVersion', 'type', 'payload', 'expectedRevisions']
  if (Object.keys(c).length !== fields.length || fields.some(key => !Object.hasOwn(c, key))) throw new CommandError('INVALID_INPUT')
  if (c.commandVersion !== 1) throw new CommandError('UPGRADE_REQUIRED')
  for (const field of ['projectId', 'dataEpoch', 'operationId', 'type']) {
    if (typeof c[field] !== 'string' || !c[field]) throw new CommandError('INVALID_INPUT')
  }
  if (!c.expectedRevisions || typeof c.expectedRevisions !== 'object' || Array.isArray(c.expectedRevisions)
    || Object.values(c.expectedRevisions).some(r => !Number.isSafeInteger(r) || Number(r) < 0)) throw new CommandError('INVALID_INPUT')
  canonicalJson(c)
}

/** Browser-compatible binding of a receipt to the complete frozen command. */
export async function commandDigest(command: Command): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(command))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Pure command calculation shared by optimistic drafts and server transactions. */
export interface CommandHandler {
  managementOnly?: boolean
  apply(data: Json, command: Command): Json
}

/** Existing probe transport budget, shared by preflight and gateway; measured production limits remain separate. */
export const GATEWAY_REQUEST_BYTES = 16384
export function assertGatewayRequestSize(event: unknown) {
  if (new TextEncoder().encode(canonicalJson(event)).byteLength > GATEWAY_REQUEST_BYTES) throw new CommandError('REQUEST_TOO_LARGE')
}
