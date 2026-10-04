import cloudbase from '@cloudbase/node-sdk'
import { cloudBaseTransactionStore } from './cloudBaseTransactionStore.ts'
import { probeGateway } from './probeGateway.ts'
import { probeImages } from './probeImages.ts'

let gateway: ReturnType<typeof probeGateway> | undefined
export async function main(event: unknown) {
  try {
    const env = process.env.FUSION_PROBE_ENV
    const projects = (process.env.FUSION_PROBE_PROJECTS ?? '').split(',')
    if (env !== 'dev-d1gh3jw1gdf06af22' || projects.length !== 2
      || projects.some(id => !/^fusion-gateway-[a-f0-9-]{36}$/.test(id))) return { ok: false, error: { code: 'PROBE_NOT_CONFIGURED' } }
    if (!gateway) {
      const app = cloudbase.init({ env, region: 'ap-shanghai' })
      gateway = probeGateway(cloudBaseTransactionStore(app.database()), projects, probeImages(app))
    }
    return await gateway(event)
  } catch {
    return { ok: false, error: { code: 'INTERNAL_ERROR' } }
  }
}
