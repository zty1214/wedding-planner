// Read-only environment-wide database export. BSON types survive JSON encryption.
import { EJSON } from 'bson'
import { collectBackupSource } from './backup.mjs'
export async function collectEnvironmentDatabase(db, names, metadata = {}, additional = {}) {
  const sourceEnvironmentId = db?.config?.envName
  if (!sourceEnvironmentId || !Array.isArray(names) || !names.length || names.some(n => Object.hasOwn(additional, n))) throw Error('EXPLICIT_ENVIRONMENT_COLLECTIONS_REQUIRED')
  return collectBackupSource({ ...metadata, sourceSystem: 'cloudbase-environment', sourceProjectId: sourceEnvironmentId,
    sourceEnvironmentId, schema: 'cloudbase-environment-ejson-v1', exportedAt: new Date().toISOString(), encoding: 'bson-extended-json-canonical', consistency: 'preliminary' },
  [...names, ...Object.keys(additional)], async (name, offset, size) => {
    if (Object.hasOwn(additional, name)) return { rows: additional[name].slice(offset, offset + size), count: additional[name].length }
    const collection = db.collection(name), before = await collection.count()
    if (!before || before.code || !Number.isSafeInteger(before.total)) throw Error('SOURCE_COUNT_FAILED')
    const result = await collection.orderBy('_id', 'asc').skip(offset).limit(Math.min(size, 100)).get()
    if (!result || result.code || !Array.isArray(result.data)) throw Error('SOURCE_READ_FAILED')
    const after = await collection.count()
    if (!after || after.code || after.total !== before.total) throw Error('SOURCE_CHANGED_DURING_READ')
    return { rows: result.data.map(row => EJSON.serialize(row, { relaxed: false })), count: before.total }
  })
}
