import cloudbase from '@cloudbase/node-sdk'
import { businessConfiguration } from './businessConfiguration.ts'
import { businessGateway } from './businessGateway.ts'
import { cloudBaseTransactionStore } from './cloudBaseTransactionStore.ts'
let gateway: ReturnType<typeof businessGateway> | undefined
export async function main(event: unknown) {
  try {
    if (!gateway) {
      const config = businessConfiguration(process.env)
      const app = cloudbase.init({ env: config.environmentId, region: config.region })
      gateway = businessGateway(cloudBaseTransactionStore(app.database(), config.collections), config.creationDailyLimit)
    }
    return await gateway(event)
  } catch { return { ok: false, error: { code: 'BUSINESS_GATEWAY_NOT_CONFIGURED' } } }
}
