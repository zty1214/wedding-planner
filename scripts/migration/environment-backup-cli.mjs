// Explicit full dev database backup; no environment/database/storage mutations.
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import cloudbase from '@cloudbase/node-sdk'
import { cloudApi, temporaryCredential, functionDetail } from '../fusion/cloudbase-cli.mjs'
import { controlledPath } from './privatePaths.mjs'
import { collectEnvironmentDatabase } from './environment-backup.mjs'
import { sealBackup, openBackup, backupSummary } from './backup.mjs'
const hash = data => createHash('sha256').update(data).digest('hex')
function cli(args) {
  try {
    const s = execFileSync('tcb', [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
    const value = JSON.parse(s.slice(s.indexOf('{')))
    if (value.error) throw Error('CLI_FAILED')
    return value.data ?? value
  } catch { throw Error('ENVIRONMENT_METADATA_READ_FAILED') }
}
async function fresh(path) {
  try { await stat(path); throw Error('OUTPUT_ALREADY_EXISTS') } catch (e) { if (e.code !== 'ENOENT') throw e }
}
function tableInventory(env) {
  const tables = []; let total
  for (let offset = 0; ; offset += 100) {
    const r = cloudApi('DescribeTables', { EnvId: env, MgoLimit: 100, MgoOffset: offset })
    if (!Array.isArray(r.Tables) || !Number.isSafeInteger(r.Pager?.Total) || (total !== undefined && total !== r.Pager.Total)) throw Error('ENVIRONMENT_COLLECTIONS_CHANGED')
    total = r.Pager.Total; tables.push(...r.Tables)
    if (tables.length === total) break
    if (!r.Tables.length || tables.length > total) throw Error('INCOMPLETE_COLLECTION_INVENTORY')
  }
  if (new Set(tables.map(t => t.TableName)).size !== tables.length) throw Error('DUPLICATE_COLLECTION_INVENTORY')
  return tables.sort((a, b) => a.TableName.localeCompare(b.TableName))
}
try {
  const { values } = parseArgs({ options: { environment: { type: 'string' }, output: { type: 'string' }, 'key-file': { type: 'string' }, 'read-source': { type: 'boolean' } } })
  if (values.environment !== 'dev-d1gh3jw1gdf06af22') throw Error('AUTHORIZED_DEV_ENVIRONMENT_REQUIRED')
  if (!values['read-source']) { console.log(JSON.stringify({ mode: 'dry-run', environmentId: values.environment })); }
  else {
    const env = values.environment, output = await controlledPath(values.output), keyPath = await controlledPath(values['key-file'])
    await fresh(output); await fresh(keyPath)
    const key = randomBytes(32); await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 })
    const environment = cloudApi('DescribeEnvs', {}).EnvList?.find(e => e.EnvId === env)
    if (!environment || environment.Region !== 'ap-shanghai' || environment.Status !== 'NORMAL') throw Error('SOURCE_ENVIRONMENT_NOT_NORMAL')
    const tables = tableInventory(env), names = tables.map(t => t.TableName), acls = {}
    for (const name of names) acls[name] = cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: name })
    const functions = [], list = cli(['fn', 'list', '-e', env, '--limit', '100'])
    if (!Array.isArray(list.Functions) || list.Functions.length !== list.TotalCount) throw Error('INCOMPLETE_FUNCTION_INVENTORY')
    for (const fn of list.Functions) functions.push(functionDetail(env, fn.FunctionName))
    const app = cloudbase.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }), db = app.database()
    const inventory = cli(['storage', 'list', '-e', env])
    if (!Array.isArray(inventory) || new Set(inventory.map(f => f.key)).size !== inventory.length || environment.Storages.length !== 1) throw Error('STORAGE_INVENTORY_INVALID')
    const files = [], bucket = environment.Storages[0].Bucket
    for (const file of inventory) {
      const result = await app.downloadFile({ fileID: `cloud://${env}.${bucket}/${file.key}` })
      if (result.code || !Buffer.isBuffer(result.fileContent) || result.fileContent.length !== Number(file.size)) throw Error('STORAGE_DOWNLOAD_FAILED')
      files.push({ _id: file.key, ...file, fileId: `cloud://${env}.${bucket}/${file.key}`, bodyBase64: result.fileContent.toString('base64'), sha256: hash(result.fileContent) })
    }
    if (JSON.stringify(cli(['storage', 'list', '-e', env])) !== JSON.stringify(inventory)) throw Error('STORAGE_CHANGED_DURING_READ')
    console.log(JSON.stringify({ stage: 'inventory-complete', collections: names.length, storageFiles: files.length, functions: functions.length }))
    const metadata = { environmentMetadata: environment, collectionMetadata: tables, collectionACLs: acls, functionConfigurations: functions,
      scope: 'all-database-collections-and-listed-cloud-storage-files', exclusions: ['function-code-packages', 'static-website-files', 'authentication-users', 'database-index-definitions'] }
    const first = await collectEnvironmentDatabase(db, names, metadata, { cloudbase_storage_objects: files })
    const second = await collectEnvironmentDatabase(db, names, metadata, { cloudbase_storage_objects: files })
    if (hash(first.rawJson) !== hash(second.rawJson) || JSON.stringify(tableInventory(env).map(t => t.TableName)) !== JSON.stringify(names)) throw Error('SOURCE_CHANGED_BETWEEN_EXPORTS')
    first.manifest.twoPassContentMatch = true
    const envelope = sealBackup(first.rawJson, first.manifest, key)
    await writeFile(output, JSON.stringify(envelope) + '\n', { flag: 'wx', mode: 0o600 })
    const restored = openBackup(JSON.parse(await readFile(output, 'utf8')), await readFile(keyPath))
    if (restored.rawJson !== first.rawJson) throw Error('BACKUP_DISK_VERIFICATION_FAILED')
    for (const file of JSON.parse(restored.rawJson).cloudbase_storage_objects) if (hash(Buffer.from(file.bodyBase64, 'base64')) !== file.sha256) throw Error('STORAGE_BACKUP_VERIFICATION_FAILED')
    console.log(JSON.stringify({ mode: 'read-only-environment-backup', ...backupSummary(restored), encryptedFileSha256: hash(await readFile(output)), twoPassContentMatch: true, storageBytes: files.reduce((n, f) => n + Number(f.size), 0), functionConfigurations: functions.length, exclusions: metadata.exclusions }))
  }
} catch (e) {
  console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]+$/.test(e.message) ? e.message : 'ENVIRONMENT_BACKUP_FAILED' })); process.exitCode = 1
}
