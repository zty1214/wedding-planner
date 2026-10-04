import { assertCreation, creationProjectId } from '../../src/fusion/projectCreation.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import { businessDay, hashSecret } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'
/** Bounded creation in the isolated development namespace; unknown reads never create. */
export function projectService(store: TransactionStore, now = () => new Date(), dailyLimit = 20) {
  return {
    async create(input: unknown) {
      assertCreation(input)
      const request = structuredClone(input), projectId = creationProjectId(request.requestId)
      const digest = hashSecret(canonicalJson(request))
      return store.run(projectId, async tx => {
        const access = await tx.access(), current = await tx.current()
        if (access || current) {
          if (!access || !current || access.creationDigest !== digest) throw new CommandError('OPERATION_ID_REUSED')
          return { projectId }
        }
        await tx.reserveCreation(businessDay(now()), dailyLimit)
        const data = emptyCore(); data.config.title = request.title
        await tx.putAccess({ creationDigest: digest, collaborationHash: hashSecret(request.collaborationSecret), managementHash: hashSecret(request.managementSecret) })
        await tx.putCurrent({ dataEpoch: request.requestId, snapshotRevision: 0, data })
        return { projectId }
      })
    },
  }
}
