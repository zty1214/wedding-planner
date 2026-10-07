// Authenticated encrypted input only; default plans recovery without network access.
import { parseArgs } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { validateFusionCollections } from './source-readers.mjs'
import { controlledPath } from './privatePaths.mjs'
import { recoverFusionProject, cloudBaseRecoveryStore, planFusionRecovery } from './fusion-recovery.mjs'
try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, 'key-file': { type: 'string' }, 'target-config': { type: 'string' }, action: { type: 'string' }, apply: { type: 'boolean' } } })
  const keyPath = await controlledPath(values['key-file'])
  if (((await stat(keyPath)).mode & 0o777) !== 0o600) throw Error('PRIVATE_KEY_PERMISSIONS_REQUIRED')
  const key = await readFile(keyPath), envelope = JSON.parse(await readFile(await controlledPath(values.input), 'utf8'))
  const action = values.action ?? 'dry-run'
  // Authenticate/validate before acquiring cloud credentials, including write modes.
  const validated = planFusionRecovery(envelope, key), plan = validated.summary
  let result = plan
  if (action === 'dry-run') { if (values.apply) throw Error('DRY_RUN_CANNOT_APPLY') }
  else {
    if (!values.apply || !values['target-config'] || !['prepare', 'import', 'verify', 'publish'].includes(action)) throw Error('EXPLICIT_RECOVERY_APPLY_REQUIRED')
    const target = JSON.parse(await readFile(await controlledPath(values['target-config']), 'utf8'))
    if (!target.environmentId || target.sourceEnvironmentId !== validated.backup.manifest.sourceEnvironmentId || target.environmentId === target.sourceEnvironmentId || target.isolated !== true || !target.batchId) throw Error('EXPLICIT_ISOLATED_RECOVERY_REQUIRED')
    validateFusionCollections(target.collections)
    const { default: cloudbase } = await import('@cloudbase/node-sdk'), { temporaryCredential } = await import('../fusion/cloudbase-cli.mjs')
    const db = cloudbase.init({ env: target.environmentId, region: 'ap-shanghai', ...temporaryCredential(target.environmentId) }).database()
    result = await recoverFusionProject(cloudBaseRecoveryStore(db, target.collections), envelope, key, target, action)
  }
  console.log(JSON.stringify(result))
} catch (error) { console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'RECOVERY_OPERATION_FAILED' })); process.exitCode = 1 }
