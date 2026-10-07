// Production-build browser verification, isolated fictitious config and no cloud traffic.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { preview } from 'vite'
import { chromium } from 'playwright'
const parent = await mkdtemp(join(tmpdir(), 'planner-business-frontend-test-'))
const output = join(parent, 'candidate')
let server, browser
try {
  execFileSync(process.execPath, ['scripts/release/build-business-frontend.mjs', '--output', output, '--target-env', 'isolated-preprod-validation', '--publishable-key', 'fictitious-public-key', '--function', 'planner-fusion-gateway'],
    { stdio: 'pipe', env: { ...process.env, VITE_FUSION_ONLY: 'false', VITE_SUPABASE_URL: 'https://legacy.invalid', VITE_SUPABASE_ANON_KEY: 'fictitious-old-key', VITE_FUSION_FUNCTION: 'planner-fusion-gateway-probe' } })
  for (const [env, fn] of [['dev-d1gh3jw1gdf06af22', 'planner-fusion-gateway'], ['isolated-preprod-validation', 'planner-fusion-gateway-probe']]) {
    const result = spawnSync(process.execPath, ['scripts/release/build-business-frontend.mjs', '--output', join(parent, 'invalid'), '--target-env', env, '--publishable-key', 'fictitious-public-key', '--function', fn], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes('INDEPENDENT_FRONTEND_CONFIG_REQUIRED'))
  }
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  assert.equal(manifest.fusionOnly, true)
  assert.equal(manifest.legacyDatabaseConfigured, false)
  for (const [file] of manifest.artifacts) if (file.endsWith('.js')) {
    const code = await readFile(file, 'utf8')
    assert.ok(!code.includes('legacy.invalid') && !code.includes('fictitious-old-key') && !code.includes('planner-fusion-gateway-probe'))
  }
  server = await preview({ build: { outDir: join(output, 'site') }, preview: { host: '127.0.0.1', port: 0 } })
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  const context = await browser.newContext()
  const external = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    external.push(url.hostname); return route.abort()
  })
  const page = await context.newPage()
  for (const path of ['/', '/guests', '/seating', '/stay', '/notes', '/p/old-project/guests', '/unknown']) {
    await page.goto(origin + path)
    await page.getByRole('heading', { name: '我的备婚项目', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/fusion')
  }
  await page.goto(origin + '/fusion/p/fusion-created-12345678-1234-1234-1234-123456789abc/guests')
  await page.waitForTimeout(500)
  assert.equal(new URL(page.url()).pathname, '/fusion/p/fusion-created-12345678-1234-1234-1234-123456789abc/guests')
  assert.deepEqual(external, [])
  console.log(JSON.stringify({ status: 'passed', mode: 'production-build-isolated-browser', legacyPathsRedirected: 7, externalRequests: 0, inheritedLegacyConfigExcluded: true }))
} catch {
  console.error('BUSINESS_FRONTEND_VERIFICATION_FAILED'); process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  await rm(parent, { recursive: true, force: true })
}
