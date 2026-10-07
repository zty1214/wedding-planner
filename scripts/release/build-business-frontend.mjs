// Offline candidate build. No cloud writes or website deployment.
import { parseArgs } from 'node:util'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { build } from 'vite'
import { controlledPath } from '../migration/privatePaths.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
async function files(dir) {
  const rows = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) rows.push(...await files(path))
    else if (entry.isFile()) rows.push([path, sha(await readFile(path))])
  }
  return rows.sort(([a], [b]) => a.localeCompare(b))
}
try {
  const { values } = parseArgs({ options: Object.fromEntries(['output', 'target-env', 'publishable-key', 'function'].map(k => [k, { type: 'string' }])) })
  const environmentId = values['target-env'], functionName = values.function
  if (!environmentId || environmentId === 'dev-d1gh3jw1gdf06af22' || !/^[a-z0-9][a-z0-9-]{5,127}$/.test(environmentId)
    || !values['publishable-key'] || !functionName || !/^[a-z][a-z0-9-]{0,59}$/.test(functionName) || functionName.includes('probe')) throw Error('INDEPENDENT_FRONTEND_CONFIG_REQUIRED')
  const output = await controlledPath(values.output)
  await mkdir(output, { mode: 0o700 })
  const config = { VITE_FUSION_ONLY: 'true', VITE_FUSION_ENV_ID: environmentId, VITE_FUSION_PUBLISHABLE_KEY: values['publishable-key'], VITE_FUSION_FUNCTION: functionName,
    VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }
  // Explicit defines also override inherited VITE_* values. Never load .env files.
  await build({ envDir: false, define: Object.fromEntries(Object.entries(config).map(([key, value]) => ['import.meta.env.' + key, JSON.stringify(value)])),
    build: { outDir: join(output, 'site'), emptyOutDir: false }, logLevel: 'silent' })
  const manifest = { format: 'planner-business-frontend-v1', mode: 'offline-build-not-deployed',
    baselineSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceTreeSha256: sha(JSON.stringify(await files('src'))),
    publicConfigSha256: sha(JSON.stringify(config)), environmentId, functionName, fusionOnly: true, legacyDatabaseConfigured: false,
    artifacts: await files(join(output, 'site')), unresolvedDeploymentGates: ['target-runtime-and-domain-readback', 'gateway-same-version', 'permissions-and-mobile-acceptance'] }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ mode: manifest.mode, baselineSha: manifest.baselineSha, sourceTreeSha256: manifest.sourceTreeSha256, publicConfigSha256: manifest.publicConfigSha256, environmentId, functionName }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'BUSINESS_FRONTEND_BUILD_FAILED' })); process.exitCode = 1
}
