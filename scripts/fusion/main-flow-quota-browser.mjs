// Actual Chromium quota rejection in an isolated test browser; never fill user disk.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const output = process.argv[2]
if (!output) throw Error('Provide fresh artifact directory')
const origin = 'http://127.0.0.1:4194'
const report = { mode: 'isolated Chromium native IndexedDB quota rejection; local fictitious gateway', startedAt: new Date().toISOString() }
let file, fixture, browser, cdp, page, stage = 'startup'
async function wait(check) {
  const end = Date.now() + 20000
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw Error('CONDITION_TIMEOUT')
}
async function stats() {
  return page.evaluate(async () => (await fetch('/__recovery_control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stats' }) })).json())
}
async function save() { await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8') }
try {
  await mkdir(output, { recursive: true })
  file = await open(resolve(output, 'quota-browser-report.json'), 'wx')
  await new Promise((resolve, reject) => { const guard = createServer(); guard.once('error', () => reject(Error('PORT_4194_UNAVAILABLE'))); guard.listen(4194, '127.0.0.1', () => guard.close(resolve)) })
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/review-main-flow-recovery.mjs'], { stdio: 'ignore' })
  fixture.once('exit', () => {})
  await wait(async () => {
    if (fixture.exitCode !== null) throw Error('FIXTURE_STOPPED')
    try { return (await fetch(`${origin}/fusion`)).ok } catch { return false }
  })
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  page = await context.newPage(); page.setDefaultTimeout(20000)
  stage = 'native-quota-before-origin-initialization'
  cdp = await context.newCDPSession(page)
  report.browserVersion = browser.version()
  report.before = await cdp.send('Storage.getUsageAndQuota', { origin })
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 0 })
  const quota = await cdp.send('Storage.getUsageAndQuota', { origin })
  assert.equal(quota.overrideActive, true)
  report.override = { active: true, requestedQuotaBytes: 0, effectiveQuotaBytes: quota.quota }
  await page.goto(`${origin}/fusion`)
  report.nativeError = await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('isolated-quota-probe', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('probe')
    request.onerror = () => resolve(request.error?.name)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('probe', 'readwrite')
      const put = tx.objectStore('probe').put('x'.repeat(1024), 'bounded-probe')
      let error
      put.onerror = () => { error = put.error?.name }
      tx.oncomplete = () => { db.close(); resolve('WRITE_SUCCEEDED') }
      tx.onabort = () => { db.close(); resolve(error || tx.error?.name) }
    }
  }))
  if (report.nativeError !== 'QuotaExceededError') throw Error('QUOTA_OVERRIDE_NOT_ENFORCED')
  stage = 'creation-vault-quota-preserves-title-and-prevents-dispatch'
  await page.getByText('本机无法保存项目链接，请检查浏览器存储空间。', { exact: true }).waitFor()
  await page.getByLabel('新项目名称').fill('真实配额失败虚构项目')
  assert.equal(await page.getByLabel('新项目名称').inputValue(), '真实配额失败虚构项目')
  assert.equal(await page.getByRole('button', { name: '新建独立项目', exact: true }).isDisabled(), true)
  const failed = await stats()
  assert.equal(failed.projects, 0); assert.equal(failed.receipts, 0)
  report.failed = { inputPreserved: true, projects: 0, receipts: 0, blockedBeforeDispatch: true }
  await page.getByRole('button', { name: '读取验收计数', exact: true }).click()
  await page.screenshot({ path: resolve(output, 'quota-browser-failed.png'), fullPage: true })
  stage = 'reset-quota-and-create'
  await cdp.send('Storage.overrideQuotaForOrigin', { origin })
  await page.reload()
  await page.getByLabel('新项目名称').fill('真实配额恢复虚构项目')
  await page.getByRole('button', { name: '新建独立项目', exact: true }).click()
  await page.getByRole('button', { name: '打开项目', exact: true }).waitFor()
  assert.equal((await stats()).projects, 1)
  report.recovered = { projects: 1, resetQuotaThenFreshInputPassed: true, failedUnstoredInputNotClaimedRecoverableAfterReload: true }
  report.status = 'passed'
} catch (error) {
  report.status = error.message === 'QUOTA_OVERRIDE_NOT_ENFORCED' ? 'unverified' : 'failed'; report.failedStage = stage; report.failureType = error.name; if (report.status === 'unverified') report.reason = 'Quota override active but native IndexedDB write succeeded; no real quota failure proven'
  if (page) await page.screenshot({ path: resolve(output, 'quota-browser-failure.png'), fullPage: true }).catch(() => {})
  process.exitCode = report.status === 'unverified' ? 2 : 1
} finally {
  await cdp?.send('Storage.overrideQuotaForOrigin', { origin }).catch(() => {})
  await browser?.close().catch(() => {})
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM')
  report.finishedAt = new Date().toISOString()
  if (file) { await save(); await file.close() }
}
console.log(`${report.status === 'passed' ? 'PASS' : 'FAIL'} isolated quota browser (${stage})`)
