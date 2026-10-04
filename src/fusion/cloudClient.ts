import cloudbase from '@cloudbase/js-sdk'
/** Reuse a login promise within a page; never log requests or link secrets. */
let connection: Promise<(event: Record<string, unknown>) => Promise<unknown>> | undefined
export function connectGateway() {
  if (!connection) connection = (async () => {
    const env = import.meta.env.VITE_FUSION_ENV_ID, accessKey = import.meta.env.VITE_FUSION_PUBLISHABLE_KEY
    if (!env || !accessKey) throw Error('CONFIG')
    const app = cloudbase.init({ env, region: 'ap-shanghai', accessKey })
    if ((await app.auth({ persistence: 'none' }).signInAnonymously()).error) throw Error('LOGIN')
    return async (event: Record<string, unknown>) => (await app.callFunction({ name: import.meta.env.VITE_FUSION_FUNCTION || 'planner-fusion-gateway-probe', data: event })).result
  })().catch(error => { connection = undefined; throw error })
  return connection
}
