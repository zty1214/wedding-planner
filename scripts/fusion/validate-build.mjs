// Build the configured branch without credentials, cloud access or deployable output.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const output = await mkdtemp(join(tmpdir(), 'planner-fusion-build-'))
try {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', output], {
    stdio: 'inherit', env: { ...process.env, VITE_FUSION_ENV_ID: 'build-validation', VITE_FUSION_PUBLISHABLE_KEY: 'build-validation' },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally { await rm(output, { recursive: true, force: true }) }
