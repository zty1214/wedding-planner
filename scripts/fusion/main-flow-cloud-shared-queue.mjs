// Same browser storage, two actual pages, real dev gateway; one new fictitious project.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, open, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { functionDetail } from './cloudbase-cli.mjs'
const [config, manifestPath, output] = process.argv.slice(2)
if (!config || !manifestPath || !output) throw Error('Provide public config, deployment manifest and fresh artifact directory')
const origin = 'http://127.0.0.1:4197'
const report = { mode: 'real CloudBase + same Chromium context two pages sharing IndexedDB/locks', baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString() }
let file, fixture, browser, page, stage = 'startup'
async function wait(check) {
  const end = Date.now() + 30000
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw Error('CONDITION_TIMEOUT')
}
async function queue(target) {
  return target.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('wedding-planner-fusion-drafts')
    request.onerror = () => reject(Error('QUEUE_READ_FAILED'))
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('outbox', 'readonly'), rows = tx.objectStore('outbox').getAll()
      tx.oncomplete = () => { db.close(); resolve(rows.result.map(row => ({ operationId: row.command.operationId, dataEpoch: row.command.dataEpoch, type: row.command.type }))) }
      tx.onabort = () => { db.close(); reject(Error('QUEUE_READ_FAILED')) }
    }
  }))
}
try {
  await mkdir(output, { recursive: true })
  file = await open(resolve(output, 'cloud-shared-queue-report.json'), 'wx')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.env, 'dev-d1gh3jw1gdf06af22'); assert.equal(manifest.functionName, 'planner-fusion-gateway-probe')
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.LOG_EVENT_CONTEXT, 'false'); assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  report.deployment = { env: manifest.env, functionName: manifest.functionName, active: true, eventLoggingDisabled: true, manifestBundleSha256: manifest.sha256, bundleContentRehashed: false }
  await new Promise((resolve, reject) => { const guard = createServer(); guard.once('error', () => reject(Error('PORT_4197_UNAVAILABLE'))); guard.listen(4197, '127.0.0.1', () => guard.close(resolve)) })
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/main-flow-cloud-preview.mjs', config], { stdio: 'ignore' })
  await wait(async () => { if (fixture.exitCode !== null) throw Error('FIXTURE_STOPPED'); try { return (await fetch(`${origin}/fusion`)).ok } catch { return false } })
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  report.browserVersion = browser.version()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page = await context.newPage(); page.setDefaultTimeout(30000)
  await page.goto(`${origin}/fusion`)
  await page.getByLabel('新项目名称').fill('真实云端共享队列虚构项目')
  await page.getByRole('button', { name: '新建独立项目', exact: true }).click()
  await page.getByRole('button', { name: '复制管理链接', exact: true }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  report.projectId = new URL(link).pathname.split('/')[3]
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  await page.getByRole('link', { name: '宾客名单', exact: true }).click()
  await page.getByLabel('宾客姓名').fill('共享队列只应新增一次')
  await page.getByText('宾客草稿已保存在本机，尚未添加到共享名单。', { exact: true }).waitFor()
  const second = await context.newPage()
  await second.goto(link.replace('/seating', '/guests'))
  await second.getByText('已同步到云端', { exact: true }).waitFor()
  stage = 'offline-shared-queue'
  await context.setOffline(true)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await wait(async () => (await queue(page)).length === 1)
  const firstRows = await queue(page), secondRows = await queue(second)
  assert.deepEqual(secondRows, firstRows)
  report.operationId = firstRows[0].operationId; report.offlineCount = 1
  await context.setOffline(false)
  stage = 'two-pages-reconnect'
  await second.reload()
  await second.getByRole('link', { name: '宾客名单', exact: true }).waitFor()
  const resume = second.getByRole('button', { name: '确认并继续同步', exact: true })
  if (await resume.isVisible()) await resume.click()
  await wait(async () => (await queue(second)).length === 0)
  await page.close(); page = second
  stage = 'close-first-reopen-second'
  await page.reload()
  await page.getByLabel('共享队列只应新增一次的住宿需求').waitFor()
  assert.equal((await queue(page)).length, 0)
  const observed = await page.evaluate(async ({ link, operationId, dataEpoch }) => {
    const url = new URL(link), call = await (await import('/src/fusion/cloudClient.ts')).connectGateway()
    const base = { projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key') }
    const state = await call({ action: 'read', ...base }), receipt = await call({ action: 'receipt', ...base, operationId, dataEpoch })
    return { guests: state.ok ? Object.values(state.value.data.guests).filter(g => g.name === '共享队列只应新增一次').length : -1, receiptMatches: receipt.ok && receipt.value?.operationId === operationId }
  }, { link, ...firstRows[0] })
  assert.equal(observed.guests, 1); assert.equal(observed.receiptMatches, true)
  report.afterReconnectCount = 0; report.serverGuestCount = 1; report.originalReceiptConfirmed = true
  await page.screenshot({ path: resolve(output, 'cloud-shared-queue.png'), fullPage: true })
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failedStage = stage; report.failureType = error.name
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM')
  report.finishedAt = new Date().toISOString()
  if (file) { await file.write(JSON.stringify(report, null, 2) + '\n'); await file.close() }
}
console.log(`${report.status === 'passed' ? 'PASS' : 'FAIL'} cloud shared queue (${stage})`)
