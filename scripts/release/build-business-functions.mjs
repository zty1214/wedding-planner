// Offline packaging only. Never creates, configures or deploys cloud functions.
import { parseArgs } from 'node:util'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { build } from 'rolldown'
import { controlledPath } from '../migration/privatePaths.mjs'
import { businessConfiguration } from '../../server/fusion/businessConfiguration.ts'
const sha = data => createHash('sha256').update(data).digest('hex')
async function sourceTree() {
  const entries = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && path.endsWith('.ts')) entries.push([path, sha(await readFile(path))])
    }
  }
  await visit('server/fusion'); await visit('src/fusion')
  return sha(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))))
}
try {
  const { values } = parseArgs({ options: Object.fromEntries(['output', 'target-env', 'region', 'collection-prefix', 'creation-limit', 'allow-reused-dev'].map(k => [k, { type: 'string' }])) })
  const environment = { FUSION_ALLOW_REUSED_DEV: values['allow-reused-dev'], FUSION_ENV_ID: values['target-env'], FUSION_REGION: values.region,
    FUSION_COLLECTION_PREFIX: values['collection-prefix'], FUSION_CREATION_DAILY_LIMIT: values['creation-limit'] }
  businessConfiguration(environment)
  const output = await controlledPath(values.output); await mkdir(output, { mode: 0o700 })
  const artifacts = []
  for (const [name, input, clientInvocation] of [
    ['gateway', 'server/fusion/businessFunction.ts', 'business-api-only'],
    ['retention', 'server/fusion/businessRetentionFunction.ts', 'DENY_REQUIRED'],
  ]) {
    const result = await build({ input, platform: 'node', external: ['@cloudbase/node-sdk'], output: { format: 'cjs' }, write: false })
    const chunks = result.output.filter(o => o.type === 'chunk')
    if (chunks.length !== 1) throw Error('SINGLE_FUNCTION_BUNDLE_REQUIRED')
    const dir = join(output, name); await mkdir(dir, { mode: 0o700 })
    const code = chunks[0].code
    await writeFile(join(dir, 'index.js'), code, { flag: 'wx', mode: 0o600 })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'planner-fusion-' + name, version: '1.0.0', main: 'index.js', dependencies: { '@cloudbase/node-sdk': '3.18.3' } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    artifacts.push({ name, bundleSha256: sha(code), clientInvocation, handler: 'index.main', eventLogging: 'DISABLE_REQUIRED' })
  }
  const manifest = { format: 'planner-business-functions-v1', mode: 'offline-package-not-deployed',
    baselineSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceTreeSha256: await sourceTree(),
    environment, schemaVersion: 2, nodeSdkVersion: '3.18.3', artifacts,
    unresolvedDeploymentGates: ['actual-runtime-and-budget', 'independent-auth-and-domains', 'collection-deny-rules-readback', 'retention-client-invocation-denied', 'bundle-active-config-readback'] }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ mode: manifest.mode, baselineSha: manifest.baselineSha, sourceTreeSha256: manifest.sourceTreeSha256, artifacts }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'BUSINESS_PACKAGE_FAILED' })); process.exitCode = 1
}
