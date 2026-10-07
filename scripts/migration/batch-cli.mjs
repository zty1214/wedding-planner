// Defaults to dry-run. Only explicit --apply + action + private target config can connect.
import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { controlledPath } from './privatePaths.mjs'
import { acceptsBusinessProject } from '../../server/fusion/businessGateway.ts'
import { migrationBatch } from './batch.mjs'
try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, action: { type: 'string' }, 'target-config': { type: 'string' }, apply: { type: 'boolean' } } })
  const artifact = JSON.parse(await readFile(await controlledPath(values.input), 'utf8')), action = values.action ?? 'dry-run'
  let report
  if (action === 'dry-run') {
    if (values.apply) throw Error('DRY_RUN_CANNOT_APPLY')
    report = await migrationBatch(null, artifact)
  } else {
    if (!values.apply || !values['target-config']) throw Error('EXPLICIT_APPLY_AND_TARGET_REQUIRED')
    if (!['prepare', 'import', 'verify', 'publish'].includes(action)) throw Error('INVALID_MIGRATION_ACTION')
    const target = JSON.parse(await readFile(await controlledPath(values['target-config']), 'utf8'))
    // Reject obvious unsafe config before acquiring any cloud credential.
    if (!target.environmentId || !target.sourceEnvironmentId || target.environmentId === target.sourceEnvironmentId || target.isolated !== true
      || !acceptsBusinessProject(target.projectId ?? '') || !target.collections?.access || !target.collections?.current) throw Error('EXPLICIT_ISOLATED_TARGET_REQUIRED')
    const { default: cloudbase } = await import('@cloudbase/node-sdk')
    const { temporaryCredential } = await import('../fusion/cloudbase-cli.mjs')
    const { cloudBaseMigrationStore } = await import('./cloudbase-batch-store.mjs')
    const db = cloudbase.init({ env: target.environmentId, region: 'ap-shanghai', ...temporaryCredential(target.environmentId) }).database()
    report = await migrationBatch(cloudBaseMigrationStore(db, target.collections), artifact, target, action)
  }
  console.log(JSON.stringify(report))
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'MIGRATION_OPERATION_FAILED'
  console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1
}
