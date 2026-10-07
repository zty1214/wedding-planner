import { assertCommand, canonicalJson, CommandError } from '../../src/fusion/protocol.ts'
import type { Receipt } from '../../src/fusion/protocol.ts'
import { authorize, hashSecret } from './commandService.ts'
import type { TransactionStore } from './commandService.ts'

/** Rotation commands contain a digest, never the new bearer secret or share URL. */
export function accessService(store: TransactionStore, now = () => new Date()) {
  return {
    read(projectId: string, secret: string, candidateHash?: string) {
      if (candidateHash !== undefined && !/^[a-f0-9]{64}$/.test(candidateHash)) throw new CommandError('INVALID_INPUT')
      return store.run(projectId, async tx => {
        const access = await tx.access()
        if (authorize(access, secret) !== 'management') throw new CommandError('FORBIDDEN')
        return { revision: access!.revision ?? 0, ...(candidateHash === undefined ? {} : { matches: candidateHash === access!.collaborationHash }) }
      })
    },
    async execute(input: unknown, secret: string): Promise<Receipt> {
      assertCommand(input)
      const command = structuredClone(input), payload = command.payload
      if (command.type !== 'access.rotateCollaboration' || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 1 || typeof payload.collaborationHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.collaborationHash)
        || Object.keys(command.expectedRevisions).length !== 1 || !Object.hasOwn(command.expectedRevisions, 'access')) throw new CommandError('INVALID_INPUT')
      const collaborationHash = payload.collaborationHash
      const digest = hashSecret(canonicalJson(command))
      return store.run(command.projectId, async tx => {
        const access = await tx.access()
        if (authorize(access, secret) !== 'management') throw new CommandError('FORBIDDEN')
        const previous = await tx.receipt(command.dataEpoch, command.operationId)
        if (previous) {
          if (previous.digest !== digest) throw new CommandError('OPERATION_ID_REUSED')
          return previous.receipt
        }
        const current = await tx.current()
        if (!current || current.dataEpoch !== command.dataEpoch) throw new CommandError('PROJECT_REPLACED')
        const revision = access!.revision ?? 0
        if (command.expectedRevisions.access !== revision) throw new CommandError('CONFLICT')
        if (revision >= Number.MAX_SAFE_INTEGER || collaborationHash === access!.managementHash || collaborationHash === access!.collaborationHash) throw new CommandError('INVALID_INPUT')
        const receipt: Receipt = { projectId: command.projectId, dataEpoch: command.dataEpoch, operationId: command.operationId,
          requestDigest: digest, committedAt: now().toISOString(), snapshotRevision: current.snapshotRevision }
        await tx.putAccess({ ...access!, revision: revision + 1, collaborationHash })
        await tx.putReceipt(command.dataEpoch, command.operationId, { digest, receipt })
        return receipt
      })
    },
  }
}
