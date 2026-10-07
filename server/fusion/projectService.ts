import { assertCreation, creationProjectId } from '../../src/fusion/projectCreation.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import { businessDay, hashSecret } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'
export const DEFAULT_DEV_CREATION_DAILY_LIMIT = 200

export function developmentCreationDailyLimit(value: string | undefined) {
  if (value === undefined) return DEFAULT_DEV_CREATION_DAILY_LIMIT
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('INVALID_DEV_CREATION_DAILY_LIMIT')
  return Number(value)
}

/** Bounded creation in the isolated development namespace; unknown reads never create. */
export function projectService(store: TransactionStore, now = () => new Date(), dailyLimit = DEFAULT_DEV_CREATION_DAILY_LIMIT) {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) throw Error('INVALID_DEV_CREATION_DAILY_LIMIT')
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
