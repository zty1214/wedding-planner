// Actual App + IndexedDB + local fictitious gateway; bounded fault injection only.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
const output = process.argv[2]
if (!output) throw Error('Provide a fresh artifact directory')
const origin = 'http://127.0.0.1:4194'
const report = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), mode: 'real App + IndexedDB + local MemoryStore gateway; handoff/cleanup/lost-response injection', startedAt: new Date().toISOString(), results: [] }
let file, browser, fixture, page, link, stage = 'startup'
async function wait(check) { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)) } throw Error('CONDITION_TIMEOUT') }
const button = (name, target = page) => target.getByRole('button', { name, exact: true })
async function stats() { return page.evaluate(async () => (await fetch('/__recovery_control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stats' }) })).json()) }
async function observe() {
  return page.evaluate(async link => { const url = new URL(link), call = await (await import('/src/fusion/cloudClient.ts')).connectGateway(); const result = await call({ action: 'read', projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key') }); if (!result.ok) throw Error('OBSERVATION_FAILED'); return { ...result.value, data: { ...result.value.data, guests: Object.values(result.value.data.guests) } } }, link)
}
async function forms(kind) {
  return page.evaluate(async ({ kind, projectId }) => { const module = await import('/src/fusion/' + kind.toLowerCase() + 'Drafts.ts'), vault = await module['open' + kind + 'DraftVault'](); try { return await vault.list(projectId) } finally { vault.close() } }, { kind, projectId: report.projectId })
}
async function queue() { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('wedding-planner-fusion-drafts'); request.onerror = () => reject(Error('READ_FAILED')); request.onsuccess = () => { const db = request.result, tx = db.transaction('outbox', 'readonly'), rows = tx.objectStore('outbox').getAll(); tx.oncomplete = () => { db.close(); resolve(rows.result) }; tx.onabort = () => { db.close(); reject(Error('READ_FAILED')) } } })) }
async function snapshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true, mask: [page.getByRole('region', { name: '协作链接管理' })] }) }
async function record(name, facts) { report.results.push({ name, status: 'passed', ...facts }); await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); console.log('PASS ' + name) }
async function recoverGuest(name) {
  await page.locator('summary').filter({ hasText: '恢复本机宾客草稿' }).click()
  await page.getByRole('button', { name: new RegExp('^' + name + ' ·') }).click()
  await wait(async () => await page.getByLabel('宾客姓名').inputValue() === name)
}
async function recoverNote(title) {
  await button('写笔记').click()
  await page.locator('summary').filter({ hasText: '恢复本机笔记表单' }).click()
  await page.getByRole('button', { name: new RegExp('^' + title + ' ·') }).click()
  await wait(async () => await page.getByLabel('笔记标题').inputValue() === title)
}
async function discard() { await button('放弃本次列表中的草稿').click(); await button('核对云端并确认放弃').click() }
try {
  await mkdir(output, { recursive: true }); file = await open(resolve(output, 'edit-recovery-report.json'), 'wx')
  await new Promise((resolve, reject) => { const guard = createServer(); guard.once('error', () => reject(Error('PORT_4194_UNAVAILABLE'))); guard.listen(4194, '127.0.0.1', () => guard.close(resolve)) })
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/review-main-flow-recovery.mjs'], { stdio: 'ignore' })
  await wait(async () => { if (fixture.exitCode !== null) throw Error('FIXTURE_STOPPED'); try { return (await fetch(origin + '/fusion')).ok } catch { return false } })
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  report.browserVersion = browser.version()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort() })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  await page.goto(origin + '/fusion'); await page.getByLabel('新项目名称').fill('编辑恢复虚构项目'); await button('新建独立项目').click(); await button('复制管理链接').click()
  link = await page.evaluate(() => navigator.clipboard.readText()); report.projectId = new URL(link).pathname.split('/')[3]
  await button('打开项目').click(); await page.getByRole('link', { name: '宾客名单', exact: true }).click()
  await page.getByLabel('宾客姓名').fill('待编辑虚构宾客'); await page.getByText('宾客草稿已保存在本机，尚未添加到共享名单。', { exact: true }).waitFor(); await button('添加').click()
  await wait(async () => (await stats()).guests === 1); await page.getByText('已同步到云端', { exact: true }).waitFor()
  stage = 'guest-edit-handoff-save-failure'
  await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('编辑后虚构宾客'); await page.getByLabel('宾客电话').fill('00123456789'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor()
  const originalGuest = (await forms('Guest'))[0]; const beforeGuest = await stats()
  await button('模拟交接保存失败').click(); await button('保存修改').click(); await page.getByText('操作未完成，表单保留；请核对本机草稿与共享名单后重试。', { exact: true }).waitFor()
  assert.equal((await stats()).receipts, beforeGuest.receipts); assert.equal((await queue()).length, 0); assert.equal((await observe()).data.guests[0].name, '待编辑虚构宾客')
  await page.reload(); await recoverGuest('编辑后虚构宾客'); assert.equal(await page.getByLabel('宾客电话').inputValue(), '00123456789'); assert.equal((await forms('Guest'))[0].id, originalGuest.id)
  await record(stage, { operationId: originalGuest.id, noDispatch: true, inputAndOriginalIdAfterReload: true })
  stage = 'guest-edit-cleanup-failure'
  await button('恢复交接保存').click(); await button('模拟表单清理失败').click(); await button('保存修改').click(); await page.getByText('请求已交接，但表单清理失败。请点击核对原提交；不会重复添加。', { exact: true }).waitFor()
  await wait(async () => (await observe()).data.guests[0].name === '编辑后虚构宾客'); assert.equal((await forms('Guest'))[0].handoff.operationId, originalGuest.id)
  const committedGuest = await stats(); assert.equal(committedGuest.receipts, beforeGuest.receipts + 1)
  await page.reload(); await recoverGuest('编辑后虚构宾客'); await button('核对原提交').click(); await page.getByText('请求已交接，但表单清理失败。请点击核对原提交；不会重复添加。', { exact: true }).waitFor(); assert.equal((await stats()).receipts, committedGuest.receipts)
  await button('恢复表单清理').click(); await button('核对原提交').click(); await wait(async () => (await forms('Guest')).length === 0); await page.reload(); assert.equal((await stats()).receipts, committedGuest.receipts); assert.equal((await observe()).data.guests.length, 1)
  await snapshot('guest-edit-recovered'); await record(stage, { operationId: originalGuest.id, receiptsAdded: 1, repeatCheckAddedReceipts: 0, formsAfterCleanup: 0 })
  stage = 'note-edit-handoff-save-failure'
  await page.getByRole('link', { name: '备婚笔记', exact: true }).click(); await button('写笔记').click(); await page.getByLabel('笔记标题').fill('待编辑虚构笔记'); await page.getByLabel('笔记正文').fill('原正文'); await page.getByText('笔记草稿已保存在本机，尚未共享', { exact: true }).waitFor(); await button('发布').click(); await wait(async () => (await observe()).notes.length === 1); await page.getByText('已同步到云端', { exact: true }).waitFor()
  await button('编辑').click(); await page.getByLabel('笔记正文').fill('编辑后保留的完整正文'); await page.getByText('笔记草稿已保存在本机，尚未共享', { exact: true }).waitFor()
  const originalNote = (await forms('Note'))[0], beforeNote = await stats()
  await button('模拟交接保存失败').click(); await button('保存修改').click(); await page.getByText('未能完成交接核对或清理，草稿仍保留。可重试核对；如云端已变化，请关闭后重新打开当前笔记编辑。', { exact: true }).waitFor(); assert.equal((await stats()).receipts, beforeNote.receipts); assert.equal((await observe()).notes[0].content, '原正文')
  await page.reload(); await recoverNote('待编辑虚构笔记'); assert.equal(await page.getByLabel('笔记正文').inputValue(), '编辑后保留的完整正文'); assert.equal((await forms('Note'))[0].id, originalNote.id)
  await record(stage, { operationId: originalNote.id, noDispatch: true, contentAndOriginalIdAfterReload: true })
  stage = 'note-edit-cleanup-failure'
  await button('恢复交接保存').click(); await button('模拟表单清理失败').click(); await button('保存修改').click(); await page.getByText('未能完成交接核对或清理，草稿仍保留。可重试核对；如云端已变化，请关闭后重新打开当前笔记编辑。', { exact: true }).waitFor()
  await wait(async () => (await observe()).notes[0].content === '编辑后保留的完整正文'); assert.equal((await forms('Note'))[0].handoff.operationId, originalNote.id)
  const committedNote = await stats(); assert.equal(committedNote.receipts, beforeNote.receipts + 1)
  await page.reload(); await recoverNote('待编辑虚构笔记'); await button('核对原提交').click(); await page.getByText('未能完成交接核对或清理，草稿仍保留。可重试核对；如云端已变化，请关闭后重新打开当前笔记编辑。', { exact: true }).waitFor(); assert.equal((await stats()).receipts, committedNote.receipts)
  await button('恢复表单清理').click(); await button('核对原提交').click(); await wait(async () => (await forms('Note')).length === 0); await page.reload(); assert.equal((await stats()).receipts, committedNote.receipts); assert.equal((await observe()).notes.length, 1)
  await snapshot('note-edit-recovered'); await record(stage, { operationId: originalNote.id, receiptsAdded: 1, repeatCheckAddedReceipts: 0, formsAfterCleanup: 0 })
  stage = 'unknown-result-discard-denied'
  await page.getByRole('link', { name: '宾客名单', exact: true }).click(); await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('结果未知待放弃'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor()
  await button('模拟断网').click(); await button('保存修改').click(); await wait(async () => (await queue()).length === 1); const unknown = (await queue())[0]; await page.reload(); await button('恢复网络').click(); await button('查看本机草稿').click(); await discard()
  await page.getByText('仍有请求的云端结果无法确定，尚未放弃任何草稿。请先确认并继续同步，再重新查看。', { exact: true }).waitFor(); assert.equal((await queue())[0].command.operationId, unknown.command.operationId)
  await record(stage, { operationId: unknown.command.operationId, queuePreserved: true })
  stage = 'known-conflict-permanent-discard'
  const independent = await browser.newContext({ viewport: { width: 1280, height: 900 } }), other = await independent.newPage(); other.setDefaultTimeout(15000)
  await independent.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await other.goto(link.replace('/seating', '/guests')); await other.getByText('已同步到云端', { exact: true }).waitFor(); await other.getByTitle('编辑', { exact: true }).click(); await other.getByLabel('宾客姓名').fill('另一端确认的虚构宾客'); await other.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor(); await button('保存修改', other).click()
  await wait(async () => (await observe()).data.guests[0].name === '另一端确认的虚构宾客'); await independent.close()
  await page.getByRole('dialog', { name: '本机草稿', exact: true }).getByRole('button', { name: '关闭', exact: true }).click(); await button('确认并继续同步').click(); await wait(async () => (await queue())[0]?.status === 'conflict')
  const conflictCount = (await stats()).receipts
  await button('查看本机草稿').click(); await discard(); await page.getByText('已放弃 1 项未提交草稿；另有 0 项已经在云端保存，只清除了本机待确认记录。', { exact: true }).waitFor(); assert.equal((await queue()).length, 0)
  await page.reload(); assert.equal((await queue()).length, 0); assert.equal((await observe()).data.guests[0].name, '另一端确认的虚构宾客'); assert.equal((await stats()).receipts, conflictCount)
  await snapshot('conflict-permanent-discard'); await record(stage, { operationId: unknown.command.operationId, queueAfterReopen: 0, otherValuePreserved: true, extraReceipts: 0 })
  stage = 'committed-result-discard-does-not-undo'
  await page.getByText('已同步到云端', { exact: true }).waitFor()
  await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('已保存不可撤销的虚构宾客'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor(); await button('下一次宾客修改丢响应').click(); await button('保存修改').click(); await wait(async () => (await queue()).length === 1 && (await stats()).lostResponses === 1)
  const pending = (await queue())[0], beforeDiscard = await stats(); await page.reload(); await button('查看本机草稿').click(); await discard(); await page.getByText('已放弃 0 项未提交草稿；另有 1 项已经在云端保存，只清除了本机待确认记录。', { exact: true }).waitFor(); assert.equal((await queue()).length, 0); assert.equal((await stats()).receipts, beforeDiscard.receipts)
  await page.reload(); assert.equal((await queue()).length, 0); assert.equal((await observe()).data.guests[0].name, '已保存不可撤销的虚构宾客'); assert.equal((await stats()).receipts, beforeDiscard.receipts)
  await snapshot('committed-discard-reopened'); await record(stage, { operationId: pending.command.operationId, queueAfterReopen: 0, serverValuePreserved: true, extraReceipts: 0 })
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failedStage = stage; report.failureType = error.name
  if (page) await snapshot('failure').catch(() => {})
  process.exitCode = 1; console.error('FAIL ' + stage + ' (details redacted)')
} finally {
  await browser?.close().catch(() => {}); if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM')
  report.finishedAt = new Date().toISOString(); if (file) { await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); await file.close() }
}
