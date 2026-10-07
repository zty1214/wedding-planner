import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
test('offline business packages bind source/config/content and expose only configured entrypoints without deploying', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-business-package-test-')), output = join(dir, 'fresh')
  try {
    const args = ['--experimental-strip-types', 'scripts/release/build-business-functions.mjs', '--output', output, '--target-env', 'fictional-preprod-123', '--region', 'ap-shanghai', '--collection-prefix', 'planner_fusion_preprod', '--creation-limit', '200']
    const run = extra => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' })
    const result = run([]); assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.mode, 'offline-package-not-deployed'); assert.match(manifest.sourceTreeSha256, /^[a-f0-9]{64}$/)
    assert.equal((await stat(output)).mode & 0o777, 0o700)
    for (const entry of manifest.artifacts) {
      const path = join(output, entry.name, 'index.js'), code = await readFile(path, 'utf8')
      assert.equal(createHash('sha256').update(code).digest('hex'), entry.bundleSha256)
      assert.ok(!code.includes('probe.increment')); assert.ok(!code.includes('PROBE_NOT_CONFIGURED'))
      const sdk = require.resolve('@cloudbase/node-sdk')
      // Package lives outside node_modules; make only the installed SDK discoverable for offline smoke check.
      const { mkdir, symlink } = await import('node:fs/promises'), dependencyDir = join(output, entry.name, 'node_modules', '@cloudbase')
      await mkdir(dependencyDir, { recursive: true }); await symlink(join(sdk, '..', '..'), join(dependencyDir, 'node-sdk'))
      const functionModule = require(path); assert.equal(typeof functionModule.main, 'function')
      const response = await functionModule.main({ action: 'probe.increment' })
      assert.equal(response.ok, false); assert.ok(JSON.stringify(response).includes('BUSINESS_GATEWAY_NOT_CONFIGURED'))
    }
    assert.equal(run([]).status, 1)
    const forbidden = spawnSync(process.execPath, [...args.slice(0, 3), '--output', join(dir, 'forbidden'), '--target-env', 'dev-d1gh3jw1gdf06af22', '--region', 'ap-shanghai', '--collection-prefix', 'planner_fusion_preprod', '--creation-limit', '200'], { encoding: 'utf8' })
    assert.equal(forbidden.status, 1); await assert.rejects(access(join(dir, 'forbidden')), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
