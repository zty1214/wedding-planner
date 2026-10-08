import type { FusionCollections } from './cloudBaseTransactionStore.ts'
/** Separate candidate environment; no defaults copied from the live source/probe. */
export function businessConfiguration(env: Record<string, string | undefined>) {
  const environmentId = env.FUSION_ENV_ID, prefix = env.FUSION_COLLECTION_PREFIX, limit = env.FUSION_CREATION_DAILY_LIMIT
  if (!environmentId || (environmentId === 'dev-d1gh3jw1gdf06af22' && env.FUSION_ALLOW_REUSED_DEV !== 'true') || !/^[a-z0-9][a-z0-9-]{5,127}$/.test(environmentId)
    || env.FUSION_REGION !== 'ap-shanghai' || !prefix || !/^planner_fusion_[a-z][a-z0-9_]{0,60}$/.test(prefix)
    || prefix === 'planner_fusion_probe' || !limit || !/^[1-9][0-9]*$/.test(limit) || !Number.isSafeInteger(Number(limit))) throw Error('BUSINESS_GATEWAY_NOT_CONFIGURED')
  const collections: FusionCollections = { access: prefix + '_access', current: prefix + '_current', receipts: prefix + '_receipts', activity: prefix + '_activity' }
  return { environmentId, region: env.FUSION_REGION, collections, creationDailyLimit: Number(limit) }
}
