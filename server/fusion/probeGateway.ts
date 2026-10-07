import { fusionGateway } from './gateway.ts'
import { DEFAULT_DEV_CREATION_DAILY_LIMIT } from './projectService.ts'
import { CommandError } from '../../src/fusion/protocol.ts'
import type { Handler, TransactionStore } from './commandService.ts'
import type { ProbeImages } from './probeImages.ts'
/** Existing isolated development probe, unchanged admission and test commands. */
export function probeGateway(store: TransactionStore, projectIds: readonly string[], images?: ProbeImages, creationDailyLimit = DEFAULT_DEV_CREATION_DAILY_LIMIT) {
  const allowed = new Set(projectIds)
  const handlers = new Map<string, Handler>([
    ['probe.increment', { apply: data => {
      if (typeof data !== 'number' || !Number.isSafeInteger(data) || data >= 10000) throw new CommandError('INVALID_INPUT')
      return data + 1
    } }],
    ['probe.manage', { managementOnly: true, apply: data => data }],
  ])
  return fusionGateway(store, id => allowed.has(id) || /^fusion-created-[a-f0-9-]{36}$/.test(id), creationDailyLimit, handlers, images)
}
