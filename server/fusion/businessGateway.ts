import { fusionGateway } from './gateway.ts'
import type { TransactionStore } from './commandService.ts'
/** Unknown IDs remain unauthorized; creation is only the explicit project.create operation. */
export const acceptsBusinessProject = (id: string) => /^fusion-(created|migrated)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
export function businessGateway(store: TransactionStore, creationDailyLimit: number) {
  return fusionGateway(store, acceptsBusinessProject, creationDailyLimit)
}
