import { CommandError } from './protocol.ts'
export interface CreationRequest { requestId: string; title: string; collaborationSecret: string; managementSecret: string }
export const creationProjectId = (requestId: string) => `fusion-created-${requestId}`
export function assertCreation(value: unknown): asserts value is CreationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommandError('INVALID_INPUT')
  const r = value as Record<string, unknown>
  if (Object.keys(r).length !== 4 || typeof r.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(r.requestId)
    || typeof r.title !== 'string' || !r.title.trim() || r.title.length > 200
    || typeof r.collaborationSecret !== 'string' || !/^[a-f0-9]{64}$/.test(r.collaborationSecret)
    || typeof r.managementSecret !== 'string' || !/^[a-f0-9]{64}$/.test(r.managementSecret)
    || r.collaborationSecret === r.managementSecret) throw new CommandError('INVALID_INPUT')
}
export function newCreation(title: string): CreationRequest {
  const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const request = { requestId: crypto.randomUUID(), title, collaborationSecret: secret(), managementSecret: secret() }
  assertCreation(request); return request
}
export function projectLinks(origin: string, request: CreationRequest) {
  const base = `${origin}/fusion/p/${creationProjectId(request.requestId)}/seating`
  return { collaboration: `${base}#key=${request.collaborationSecret}`, management: `${base}#key=${request.managementSecret}` }
}
