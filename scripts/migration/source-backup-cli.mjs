// Explicit read-only source collection, encrypted output only. Default performs no network calls.
import { parseArgs } from 'node:util'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { controlledPath } from './privatePaths.mjs'
import { collectPlannerBackup, collectSeatingBackup, collectFusionBackup, validateFusionCollections } from './source-readers.mjs'
import { sealBackup, openBackup, backupSummary } from './backup.mjs'
try {
  const { values } = parseArgs({ options: { 'source-system': { type: 'string' }, 'project-id': { type: 'string' }, 'source-config': { type: 'string' },
    'read-source': { type: 'boolean' }, 'key-file': { type: 'string' }, output: { type: 'string' } } })
  const system = values['source-system'], projectId = values['project-id']
  if (!['supabase-planner', 'cloudbase-wedding', 'fusion-project'].includes(system) || !projectId) throw Error('EXPLICIT_SUPPORTED_SOURCE_REQUIRED')
  const config = JSON.parse(await readFile(await controlledPath(values['source-config']), 'utf8'))
  if (system === 'supabase-planner' ? !config.url || !config.anonKey : !config.environmentId || config.region !== 'ap-shanghai') throw Error('EXPLICIT_SOURCE_CONFIGURATION_REQUIRED')
  if (system === 'fusion-project') validateFusionCollections(config.collections)
  if (!values['read-source']) console.log(JSON.stringify({ mode: 'dry-run', configured: true, consistency: 'preliminary' }))
  else {
    const keyPath = await controlledPath(values['key-file']), output = await controlledPath(values.output)
    if (((await stat(keyPath)).mode & 0o777) !== 0o600) throw Error('PRIVATE_KEY_PERMISSIONS_REQUIRED')
    const key = await readFile(keyPath); if (key.length !== 32) throw Error('INVALID_BACKUP_KEY')
    try { await stat(output); throw Error('OUTPUT_ALREADY_EXISTS') } catch (e) { if (e.code !== 'ENOENT') throw e }
    let backup
    if (system === 'supabase-planner') {
      const { createClient } = await import('@supabase/supabase-js')
      backup = await collectPlannerBackup(createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }), projectId)
    } else {
      const { default: cloudbase } = await import('@cloudbase/node-sdk'), { temporaryCredential } = await import('../fusion/cloudbase-cli.mjs')
      const db = cloudbase.init({ env: config.environmentId, region: config.region, ...temporaryCredential(config.environmentId) }).database()
      backup = system === 'fusion-project' ? await collectFusionBackup(db, projectId, config.collections) : await collectSeatingBackup(db, projectId)
    }
    const envelope = sealBackup(backup.rawJson, backup.manifest, key), verified = openBackup(envelope, key)
    await writeFile(output, JSON.stringify(envelope) + '\n', { flag: 'wx', mode: 0o600 })
    // Re-open bytes actually on disk before reporting success.
    const disk = openBackup(JSON.parse(await readFile(output, 'utf8')), key)
    if (disk.sourceHash !== verified.sourceHash) throw Error('BACKUP_DISK_VERIFICATION_FAILED')
    console.log(JSON.stringify({ mode: 'read-only-encrypted-backup', ...backupSummary(disk) }))
  }
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_BACKUP_OPERATION_FAILED'
  console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1
}
