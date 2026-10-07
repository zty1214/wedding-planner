// New fictitious dev project only. Real SDK successes dropped at client boundary.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { functionDetail } from './cloudbase-cli.mjs'
const [config, manifestPath, output] = process.argv.slice(2)
if (!config || !manifestPath || !output) throw Error('Provide existing public config, manifest and fresh artifact directory')
const origin = 'http://127.0.0.1:4197'
const report = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), mode: 'real App + real dev CloudBase; client lost-response injection for creation and rotation', startedAt: new Date().toISOString(), results: [] }
let file, fixture, browser, page, stage = 'startup', managerLink
async function wait(check) { const end = Date.now() + 45000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)) } throw Error('CONDITION_TIMEOUT') }
const button = (name, target = page) => target.getByRole('button', { name, exact: true })
async function creation() { return page.evaluate(async () => { const v = await (await import('/src/fusion/creationVault.ts')).openCreationVault(); try { return await v.list() } finally { v.close() } }) }
async function rotation() { return page.evaluate(async projectId => { const v = await (await import('/src/fusion/accessRotation.ts')).openRotationVault(); try { return await v.list(projectId) } finally { v.close() } }, report.projectId) }
async function call(action, extra = {}, link = managerLink, target = page) {
  return target.evaluate(async ({ action, extra, link }) => {
    const url = new URL(link), invoke = await (await import('/src/fusion/cloudClient.ts')).connectGateway()
    return await Promise.race([invoke({ action, projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key'), ...extra }), new Promise((_, reject) => setTimeout(() => reject(Error('OBSERVATION_TIMEOUT')), 30000))])
  }, { action, extra, link })
}
async function lose(type) { await page.evaluate(async type => (await import('/src/fusion/cloudClient.ts')).reviewLoseNext(type), type) }
async function lost() { return page.evaluate(async () => (await import('/src/fusion/cloudClient.ts')).reviewLossCount()) }
async function record(name, facts) { report.results.push({ name, status: 'passed', ...facts }); await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); console.log('PASS ' + name) }
async function screenshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true, mask: [page.getByRole('region', { name: '协作链接管理' })] }) }
try {
  await mkdir(output, { recursive: true }); file = await open(resolve(output, 'cloud-link-recovery-report.json'), 'wx')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); assert.equal(manifest.env, 'dev-d1gh3jw1gdf06af22'); assert.equal(manifest.functionName, 'planner-fusion-gateway-probe')
  const detail = functionDetail(manifest.env, manifest.functionName), vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value])); assert.equal(detail.Status, 'Active'); assert.equal(vars.LOG_EVENT_CONTEXT, 'false'); assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  report.deployment = { env: manifest.env, functionName: manifest.functionName, active: true, eventLoggingDisabled: true, manifestBundleSha256: manifest.sha256, bundleContentRehashed: false }
  await new Promise((resolve, reject) => { const guard = createServer(); guard.once('error', () => reject(Error('PORT_4197_UNAVAILABLE'))); guard.listen(4197, '127.0.0.1', () => guard.close(resolve)) })
  fixture = spawn(process.execPath, ['scripts/fusion/main-flow-cloud-preview.mjs', config], { stdio: 'ignore' })
  await wait(async () => { if (fixture.exitCode !== null) throw Error('FIXTURE_STOPPED'); try { return (await fetch(origin + '/fusion')).ok } catch { return false } })
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) }); report.browserVersion = browser.version()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }); page = await context.newPage(); page.setDefaultTimeout(30000)
  stage = 'creation-success-lost-response'
  await page.goto(origin + '/fusion'); await lose('project.create'); await page.getByLabel('新项目名称').fill('云端链接恢复虚构项目'); await button('新建独立项目').click(); await wait(async () => await page.getByText('尚未确认创建成功。已保存的请求可点击重试，不要重复新建。', { exact: true }).isVisible() || await page.getByText('今日开发环境创建额度已用完，请保留本机请求后重试。', { exact: true }).isVisible()); if (await page.getByText('今日开发环境创建额度已用完，请保留本机请求后重试。', { exact: true }).isVisible()) throw Error('DEV_CREATION_RATE_LIMITED')
  assert.equal(await lost(), 1); const first = await creation(); assert.equal(first.length, 1); assert.equal(first[0].confirmed, false)
  const original = first[0].request; report.projectId = 'fusion-created-' + original.requestId
  managerLink = origin + '/fusion/p/' + report.projectId + '/seating#key=' + original.managementSecret
  const before = await call('read'); assert.equal(before.ok, true); const originalEpoch = before.value.dataEpoch
  await page.reload(); assert.deepEqual((await creation())[0].request, original); assert.equal(await button('新建独立项目').isDisabled(), true)
  await button('重试并确认创建结果').click(); await button('打开项目').waitFor(); const resolved = await creation(); assert.equal(resolved.length, 1); assert.equal(resolved[0].confirmed, true); assert.deepEqual(resolved[0].request, original)
  await button('复制管理链接').click(); const copiedManager = await page.evaluate(() => navigator.clipboard.readText()); assert.equal(copiedManager, managerLink)
  await button('复制协作链接').click(); const oldLink = await page.evaluate(() => navigator.clipboard.readText()); assert.equal(new URLSearchParams(new URL(oldLink).hash.slice(1)).get('key'), original.collaborationSecret); assert.equal(new URL(oldLink).pathname.split('/')[3], report.projectId)
  assert.equal((await call('read')).value.dataEpoch, originalEpoch)
  await screenshot('creation-recovered'); await record(stage, { originalRequestId: original.requestId, sameProject: true, sameOriginalSecretsInMemory: true, creationEntries: 1, sameEpochAfterRetry: true, actualProductCopyMatched: true })
  await button('打开项目').click(); await page.getByText('已同步到云端', { exact: true }).waitFor()
  const independent = await browser.newContext({ viewport: { width: 1280, height: 900 } }), other = await independent.newPage(); other.setDefaultTimeout(30000); await other.goto(oldLink); await other.getByText('已同步到云端', { exact: true }).waitFor()
  const managerUid = await page.evaluate(async () => (await import('/src/fusion/cloudClient.ts')).reviewIdentity()), otherUid = await other.evaluate(async () => (await import('/src/fusion/cloudClient.ts')).reviewIdentity()); assert.ok(managerUid && otherUid && managerUid !== otherUid); report.identitiesDistinct = true
  stage = 'rotation-success-lost-response'
  await button('协作链接').click(); await button('准备新协作链接').click(); await button('确认更换或核对原请求').waitFor()
  stage = 'rotation/read-original-candidate'; const candidate = (await rotation())[0]; assert.ok(candidate); stage = 'rotation/inject-and-confirm'; await lose('access.rotateCollaboration'); await button('确认更换或核对原请求').click(); await page.getByText('未能确认完成。已保存的链接记录仍在本机；请保留记录，稍后核对原请求。若提示冲突或链接已失效，请刷新项目。', { exact: true }).waitFor(); assert.equal(await lost(), 1)
  stage = 'rotation/observe-server-commit'; const accessBefore = await call('access.read'), receiptBefore = await call('receipt', { operationId: candidate.command.operationId, dataEpoch: candidate.command.dataEpoch }); assert.equal(accessBefore.ok, true); assert.equal(accessBefore.value.revision, 1); assert.equal(receiptBefore.ok, true); assert.ok(receiptBefore.value); assert.equal(receiptBefore.value.operationId, candidate.command.operationId)
  stage = 'rotation/reopen-confirm-original'; await page.reload(); await page.getByText('已同步到云端', { exact: true }).waitFor(); await button('协作链接').click(); assert.deepEqual(await rotation(), [candidate]); await button('确认更换并复制链接').click(); await page.getByText('已重新核对并复制有效协作链接。', { exact: true }).waitFor(); const nextLink = await page.evaluate(() => navigator.clipboard.readText()); assert.equal(new URLSearchParams(new URL(nextLink).hash.slice(1)).get('key'), candidate.secret)
  assert.equal((await call('access.read')).value.revision, accessBefore.value.revision); assert.deepEqual((await call('receipt', { operationId: candidate.command.operationId, dataEpoch: candidate.command.dataEpoch })).value, receiptBefore.value)
  stage = 'rotation/old-session-denied'; const oldRead = await call('read', {}, oldLink, other); assert.equal(oldRead.ok, false); assert.equal(oldRead.error.code, 'FORBIDDEN'); await button('刷新项目', other).click(); await other.locator('header [role=status]').filter({ hasText: '无权访问，本地草稿保留' }).waitFor()
  stage = 'rotation/new-link-join'; await other.goto(nextLink); await other.getByText('已同步到云端', { exact: true }).waitFor(); assert.equal((await call('read', {}, nextLink, other)).ok, true)
  stage = 'rotation/final-screenshot'; await button('关闭').click(); await screenshot('rotation-recovered'); await independent.close()
  await record('rotation-success-lost-response', { originalOperationId: candidate.command.operationId, originalCandidateInMemoryPreserved: true, accessRevision: 1, originalReceiptUnchanged: true, candidateCopiedThroughProduct: true, oldOpenedSessionDenied: true, newLinkJoined: true })
  report.status = 'passed'
} catch (error) { report.status = error.message === 'DEV_CREATION_RATE_LIMITED' ? 'blocked' : 'failed'; if (report.status === 'blocked') report.reason = 'Dev creation daily quota reached; no limit change or new attempt'; report.failedStage = stage; report.failureType = error.name; const line = String(error.stack).match(/main-flow-cloud-link-recovery\.mjs:(\d+):/); if (line) report.failureLine = Number(line[1]); report.strictLocatorViolation = String(error.message).includes('strict mode violation'); if (page) await screenshot('failure').catch(() => {}); process.exitCode = report.status === 'blocked' ? 2 : 1; console.error('FAIL ' + stage + ' (details redacted)') }
finally { await browser?.close().catch(() => {}); if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM'); report.finishedAt = new Date().toISOString(); if (file) { await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); await file.close() } }
