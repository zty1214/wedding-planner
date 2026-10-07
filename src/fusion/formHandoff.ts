import type { Command } from './protocol.ts'
import { assertSameRequest } from './outbox.ts'
import type { projectRepository } from './repository.ts'

type Draft = { id: string; projectId: string; revision: number; handoff?: Command }
type Request = Pick<Command, 'type' | 'payload' | 'expectedRevisions' | 'dataEpoch'>

/** Freeze before dispatch. A retained form can only reconcile this exact request. */
export async function handoffForm<T extends Draft>(draft: T, repo: ReturnType<typeof projectRepository>,
  build: () => Request, save: (value: T, expected: number | null) => Promise<T>, bound: (value: T) => void) {
  if (draft.projectId !== repo.projectId) throw Error('FORM_SCOPE_MISMATCH')
  const command = () => ({ ...build(), projectId: repo.projectId, operationId: draft.id, commandVersion: 1 as const })
  let frozen = draft
  if (frozen.handoff) {
    if (frozen.handoff.projectId !== draft.projectId || frozen.handoff.operationId !== draft.id) throw Error('FORM_SCOPE_MISMATCH')
    const state = await repo.reconcileHandoff(frozen.handoff)
    if (state !== 'absent') return frozen
    // Only an absent handoff may be submitted, with its original entity/revision binding.
    assertSameRequest(frozen.handoff, command())
  } else {
    frozen = await save({ ...draft, handoff: command() }, draft.revision < 0 ? null : draft.revision)
    bound(frozen)
  }
  const c = frozen.handoff!
  if (!await repo.dispatch(c.type, c.payload, c.expectedRevisions, c.dataEpoch, c.operationId)) return null
  return frozen
}
