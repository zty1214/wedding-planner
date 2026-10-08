import { secretHash } from './accessRotation.ts'
import type { RotationRequest } from './accessRotation.ts'
import type { ProjectTransport } from './repository.ts'

/** Read-only verification. Never rotate a link merely because the user asks to copy it. */
export async function currentCollaborationSecret(projectId: string, original: string, rotations: RotationRequest[], transport: ProjectTransport) {
  if (!transport.readAccess) throw Error('LINK_VERIFICATION_UNAVAILABLE')
  const candidates = [...new Set([original, ...rotations.filter(request => request.command.projectId === projectId).map(request => request.secret)])]
  for (const secret of candidates) {
    if (!/^[a-f0-9]{64}$/.test(secret)) continue
    if ((await transport.readAccess(await secretHash(secret))).matches === true) return secret
  }
  throw Error('CURRENT_LINK_NOT_ON_DEVICE')
}
