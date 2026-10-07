// Kill only this script's Chromium subprocess; disposable profile, local fictitious App.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
const output = process.argv[2]
if (!output) throw Error('Provide fresh evidence directory')
const origin = 'http://127.0.0.1:4194'
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath()
const report = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), mode: 'actual Chromium SIGKILL + same disposable profile; local App/IndexedDB/MemoryStore gateway; controlled handoff/cleanup pause', startedAt: new Date().toISOString(), results: [], killedProcesses: 0 }
let file, profile, processHandle, browser, fixture, page, link, stage = 'startup'
async function wait(check, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)) } throw Error('CONDITION_TIMEOUT') }
const button = name => page.getByRole('button', { name, exact: true })
async function stats() { return (await fetch(origin + '/__recovery_control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stats' }) })).json() }
async function startBrowser() {
  let endpoint
  processHandle = spawn(executable, ['--headless', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  processHandle.stderr.on('data', data => { endpoint ??= String(data).match(/DevTools listening on (ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[^\s]+)/)?.[1] })
  await wait(() => { if (processHandle.exitCode !== null || processHandle.signalCode) throw Error('OWN_BROWSER_STOPPED'); return !!endpoint }, 15000)
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
  report.browserVersion = browser.version()
  const context = browser.contexts()[0]; await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort() })
  page = await context.newPage(); page.setDefaultTimeout(15000)
}
async function terminateBrowser() {
  const owned = processHandle
  assert.ok(owned?.pid && owned.exitCode === null && !owned.signalCode)
  const exited = new Promise(resolve => owned.once('exit', (code, signal) => resolve({ code, signal })))
  assert.equal(owned.kill('SIGKILL'), true)
  const actual = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('OWN_PROCESS_EXIT_TIMEOUT')), 10000))])
  assert.equal(actual.signal, 'SIGKILL'); report.killedProcesses++; browser = undefined; processHandle = undefined
}
async function restart(path = '/guests') { await startBrowser(); await page.goto(link.replace('/seating', path)) }
async function forms(kind) { return page.evaluate(async ({ kind, projectId }) => { const v = await (await import('/src/fusion/' + kind.toLowerCase() + 'Drafts.ts'))['open' + kind + 'DraftVault'](); try { return await v.list(projectId) } finally { v.close() } }, { kind, projectId: report.projectId }) }
async function queue() { return page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('wedding-planner-fusion-drafts'); r.onerror = () => reject(Error('QUEUE_READ_FAILED')); r.onsuccess = () => { const db = r.result, tx = db.transaction('outbox', 'readonly'), rows = tx.objectStore('outbox').getAll(); tx.oncomplete = () => { db.close(); resolve(rows.result) }; tx.onabort = () => { db.close(); reject(Error('QUEUE_READ_FAILED')) } } })) }
async function observe(action = 'read', extra = {}) { return page.evaluate(async ({ link, action, extra }) => { const url = new URL(link), call = await (await import('/src/fusion/cloudClient.ts')).connectGateway(); const r = await call({ action, projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key'), ...extra }); if (!r.ok) throw Error('OBSERVATION_FAILED'); return r.value }, { link, action, extra }) }
async function guestName() { return Object.values((await observe()).data.guests)[0]?.name }
async function recoverGuest(name) { await page.locator('summary').filter({ hasText: '恢复本机宾客草稿' }).click(); await page.getByRole('button', { name: new RegExp('^' + name + ' ·') }).click(); await wait(async () => await page.getByLabel('宾客姓名').inputValue() === name) }
async function recoverNote() { await button('写笔记').click(); await page.locator('summary').filter({ hasText: '恢复本机笔记表单' }).click(); await page.getByRole('button', { name: /^进程中断虚构笔记 ·/ }).click(); await wait(async () => await page.getByLabel('笔记正文').inputValue() === '已落盘的完整正文') }
async function snapshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true, mask: [page.getByRole('region', { name: '协作链接管理' })] }) }
async function record(name, facts) { report.results.push({ name, status: 'passed', ...facts }); await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); console.log('PASS ' + name) }
try {
  await mkdir(output, { recursive: true }); file = await open(resolve(output, 'process-recovery-report.json'), 'wx'); profile = await mkdtemp('/private/tmp/planner-owned-crash-profile-')
  await new Promise((resolve, reject) => { const s = createServer(); s.once('error', () => reject(Error('PORT_4194_UNAVAILABLE'))); s.listen(4194, '127.0.0.1', () => s.close(resolve)) })
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/review-main-flow-recovery.mjs'], { stdio: 'ignore' })
  await wait(async () => { if (fixture.exitCode !== null) throw Error('FIXTURE_STOPPED'); try { return (await fetch(origin + '/fusion')).ok } catch { return false } })
  await startBrowser(); await page.goto(origin + '/fusion'); await page.getByLabel('新项目名称').fill('真实进程中断虚构项目'); await button('新建独立项目').click(); await button('复制管理链接').click(); link = await page.evaluate(() => navigator.clipboard.readText()); report.projectId = new URL(link).pathname.split('/')[3]; await button('打开项目').click(); await page.getByRole('link', { name: '宾客名单', exact: true }).click()
  stage = 'unsubmitted-input-survives-process-kill'
  await page.getByLabel('宾客姓名').fill('进程中断虚构宾客'); await page.getByLabel('宾客电话').fill('00123456789'); await page.getByText('宾客草稿已保存在本机，尚未添加到共享名单。', { exact: true }).waitFor(); const initial = (await forms('Guest'))[0]
  assert.equal((await stats()).guests, 0); await terminateBrowser(); await restart(); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.equal((await queue()).length, 0); assert.equal((await stats()).guests, 0); assert.equal((await forms('Guest'))[0].id, initial.id); await recoverGuest('进程中断虚构宾客'); assert.equal(await page.getByLabel('宾客电话').inputValue(), '00123456789')
  await snapshot('input-reopened'); await record(stage, { originalFormId: initial.id, sameInput: true, queueCount: 0, serviceGuests: 0 })
  stage = 'guest-frozen-form-before-outbox-process-kill'
  await button('冻结已落盘后暂停').click(); await button('添加').click(); await wait(async () => (await forms('Guest'))[0]?.handoff?.operationId === initial.id); assert.equal((await queue()).length, 0); assert.equal((await stats()).guests, 0)
  const frozen = (await forms('Guest'))[0].handoff; await terminateBrowser(); await restart(); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.deepEqual((await forms('Guest'))[0].handoff, frozen); assert.equal((await queue()).length, 0); await recoverGuest('进程中断虚构宾客'); await button('恢复交接暂停').click(); await button('核对原提交').click(); await wait(async () => (await stats()).guests === 1 && (await forms('Guest')).length === 0); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.equal((await observe('receipt', { dataEpoch: frozen.dataEpoch, operationId: frozen.operationId })).operationId, initial.id)
  await snapshot('guest-frozen-recovered'); await record(stage, { operationId: initial.id, frozenRequestIdentical: true, beforeQueue: 0, serviceGuestsAfter: 1, originalReceipt: true })
  stage = 'note-frozen-form-before-outbox-process-kill'
  await page.getByRole('link', { name: '备婚笔记', exact: true }).click(); await button('写笔记').click(); await page.getByLabel('笔记标题').fill('进程中断虚构笔记'); await page.getByLabel('笔记正文').fill('已落盘的完整正文'); await page.getByText('笔记草稿已保存在本机，尚未共享', { exact: true }).waitFor(); const note = (await forms('Note'))[0]; await button('冻结已落盘后暂停').click(); await button('发布').click(); await wait(async () => (await forms('Note'))[0]?.handoff?.operationId === note.id); assert.equal((await queue()).length, 0); assert.equal((await stats()).notes, 0)
  const noteCommand = (await forms('Note'))[0].handoff; await terminateBrowser(); await restart('/notes'); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.deepEqual((await forms('Note'))[0].handoff, noteCommand); await recoverNote(); await button('恢复交接暂停').click(); await button('核对原提交').click(); await wait(async () => (await stats()).notes === 1 && (await forms('Note')).length === 0); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.equal((await observe('receipt', { dataEpoch: noteCommand.dataEpoch, operationId: noteCommand.operationId })).operationId, note.id)
  await snapshot('note-frozen-recovered'); await record(stage, { operationId: note.id, frozenRequestIdentical: true, beforeQueue: 0, serviceNotesAfter: 1, originalReceipt: true })
  stage = 'offline-outbox-survives-process-kill'
  await page.getByRole('link', { name: '宾客名单', exact: true }).click(); await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('进程中断离线编辑'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor(); await button('模拟断网').click(); await button('保存修改').click(); await wait(async () => (await queue()).length === 1); const offline = (await queue())[0].command, beforeOffline = await stats()
  await terminateBrowser(); await restart(); await wait(async () => (await queue()).length === 1); assert.deepEqual((await queue())[0].command, offline); assert.equal((await stats()).receipts, beforeOffline.receipts); await button('恢复网络').click(); await button('确认并继续同步').click(); await wait(async () => (await queue()).length === 0); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.equal(await guestName(), '进程中断离线编辑'); assert.equal((await stats()).receipts, beforeOffline.receipts + 1)
  await snapshot('offline-queue-recovered'); await record(stage, { operationId: offline.operationId, sameWholeCommand: true, queueBefore: 1, queueAfter: 0, receiptsAdded: 1 })
  stage = 'server-committed-before-form-cleanup-process-kill'
  await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('进程中断清理后宾客'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor(); const cleanup = (await forms('Guest'))[0], beforeCleanup = await stats(); await button('清理前暂停').click(); await button('保存修改').click(); await wait(async () => (await stats()).receipts === beforeCleanup.receipts + 1 && await page.evaluate(() => localStorage.getItem('recovery-cleanup-paused') === 'yes')); assert.equal(await guestName(), '进程中断清理后宾客'); const cleanupCommand = (await forms('Guest'))[0].handoff
  await terminateBrowser(); await restart(); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.deepEqual((await forms('Guest'))[0].handoff, cleanupCommand); await recoverGuest('进程中断清理后宾客'); await button('恢复清理暂停').click(); await button('核对原提交').click(); await wait(async () => (await forms('Guest')).length === 0); assert.equal((await stats()).receipts, beforeCleanup.receipts + 1); assert.equal((await stats()).guests, 1); assert.equal((await observe('receipt', { dataEpoch: cleanupCommand.dataEpoch, operationId: cleanup.id })).operationId, cleanup.id)
  await snapshot('cleanup-recovered'); await record(stage, { operationId: cleanup.id, originalReceipt: true, extraWritesAfterReopen: 0, formsAfter: 0, serviceGuests: 1 })
  stage = 'field-frozen-form-before-outbox-process-kill'
  await page.getByLabel('项目标题').fill('字段冻结进程中断虚构标题'); await page.getByText('已保存在本机，尚未提交。', { exact: true }).waitFor(); const field = (await forms('Field'))[0], beforeField = await stats(); await button('冻结已落盘后暂停').click(); await button('保存项目标题').click(); await wait(async () => (await forms('Field'))[0]?.handoff?.operationId === field.id); assert.equal((await queue()).length, 0); const fieldCommand = (await forms('Field'))[0].handoff
  await terminateBrowser(); await restart(); await page.getByText('已同步到云端', { exact: true }).waitFor(); assert.deepEqual((await forms('Field'))[0].handoff, fieldCommand); await page.locator('summary').filter({ hasText: '恢复本机项目标题草稿' }).click(); await page.getByRole('button', { name: /^字段冻结进程中断虚构标题 ·/ }).click(); await button('恢复交接暂停').click(); await button('核对原提交').click(); await wait(async () => (await forms('Field')).length === 0 && (await observe()).data.config.title === '字段冻结进程中断虚构标题'); assert.equal((await stats()).receipts, beforeField.receipts + 1); assert.equal((await observe('receipt', { dataEpoch: fieldCommand.dataEpoch, operationId: field.id })).operationId, field.id)
  await snapshot('field-frozen-recovered'); await record(stage, { operationId: field.id, frozenRequestIdentical: true, beforeQueue: 0, formsAfter: 0, originalReceipt: true, receiptsAdded: 1 })
  stage = 'private-form-download-before-and-after-restore'
  const current = await observe()
  await page.getByRole('link', { name: '历史版本', exact: true }).click(); await page.getByLabel('版本名称').fill('私有输入导出前虚构恢复点'); await button('保存当前版本').click(); await button('预览内容').waitFor(); await page.getByText('已同步到云端', { exact: true }).waitFor()
  await page.getByRole('link', { name: '宾客名单', exact: true }).click(); await page.getByTitle('编辑', { exact: true }).click(); await page.getByLabel('宾客姓名').fill('仅本机私有宾客修改'); await page.getByLabel('宾客电话').fill('00123456789'); await page.getByText('宾客修改已保存在本机，尚未更新共享名单。', { exact: true }).waitFor(); await button('保留草稿并关闭编辑').click()
  await page.getByLabel('项目标题').fill('仅本机私有标题'); await page.getByText('已保存在本机，尚未提交。', { exact: true }).waitFor()
  await page.getByRole('link', { name: '备婚笔记', exact: true }).click(); await button('编辑').click(); await page.getByLabel('笔记正文').fill('仅本机私有笔记完整正文'); await page.getByText('笔记草稿已保存在本机，尚未共享', { exact: true }).waitFor(); await button('关闭并保留草稿').click()
  const originalPrivate = { field: (await forms('Field'))[0], guest: (await forms('Guest'))[0], note: (await forms('Note'))[0] }
  await page.getByRole('link', { name: '宾客名单', exact: true }).click()
  // Deleted-entity fixture preparation through the normal authenticated gateway, not a delete-UI claim.
  const existing = current.data.guests[current.data.guestOrder[0]]
  await observe('execute', { command: { projectId: report.projectId, dataEpoch: current.dataEpoch, operationId: crypto.randomUUID(), commandVersion: 1, type: 'guest.delete', payload: { id: existing.id }, expectedRevisions: { ['guest:' + existing.id]: existing.revision } } }); await button('刷新项目').click(); await wait(async () => (await stats()).guests === 0); await page.getByText('已同步到云端', { exact: true }).waitFor()
  await page.getByRole('link', { name: '历史版本', exact: true }).click(); await button('预览内容').click()
  async function download(buttonName, filename, target = page) { const event = page.waitForEvent('download'); await target.getByRole('button', { name: buttonName, exact: true }).click(); const file = await event; await file.saveAs(resolve(output, filename)); const bytes = await readFile(resolve(output, filename)); const key = new URLSearchParams(new URL(link).hash.slice(1)).get('key'); assert.equal(bytes.toString().includes(key), false); return { value: JSON.parse(bytes.toString()), meta: { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } }
  const version = await download('导出此版本数据', 'actual-version.json'); assert.equal(version.value.name, '私有输入导出前虚构恢复点'); assert.equal(version.value.core.guestOrder.length, 1); assert.equal(version.value.notes[0].content, '已落盘的完整正文'); assert.equal(version.value.core.config.title, current.data.config.title)
  await button('恢复整个项目到此版本').click(); const confirm = page.getByRole('alertdialog', { name: '确认恢复整个项目', exact: true }); await confirm.getByRole('button', { name: '读取全部本机表单草稿', exact: true }).click(); await confirm.getByRole('button', { name: '导出本次表单草稿', exact: true }).waitFor()
  const beforeFile = await download('导出本次表单草稿', 'actual-private-before-restore.json', confirm)
  function checkInventory(value) { assert.equal(value.format, 'planner-private-form-drafts-v1'); assert.equal(value.projectId, report.projectId); assert.deepEqual(value.fieldDrafts, [originalPrivate.field]); assert.deepEqual(value.guestDrafts, [originalPrivate.guest]); assert.deepEqual(value.noteDrafts, [originalPrivate.note]); assert.equal(value.fieldDrafts[0].value, '仅本机私有标题'); assert.equal(value.guestDrafts[0].name, '仅本机私有宾客修改'); assert.equal(value.guestDrafts[0].phone, '00123456789'); assert.equal(value.noteDrafts[0].content, '仅本机私有笔记完整正文') }
  checkInventory(beforeFile.value); assert.equal((await stats()).guests, 0)
  await button('确认替换并保留安全版本').click(); await wait(async () => (await observe()).dataEpoch !== current.dataEpoch); await page.getByText('已同步到云端', { exact: true }).waitFor()
  const beforeExport = await stats(); await button('查看本机草稿').click(); const panel = page.getByRole('dialog', { name: '本机草稿', exact: true }); await panel.getByRole('button', { name: '读取全部本机表单草稿', exact: true }).click(); await panel.getByRole('button', { name: '导出本次表单草稿', exact: true }).waitFor()
  const afterFile = await download('导出本次表单草稿', 'actual-private-after-restore.json', panel); checkInventory(afterFile.value); assert.equal((await stats()).receipts, beforeExport.receipts); assert.equal((await queue()).length, 0); assert.equal(afterFile.value.guestDrafts[0].dataEpoch, current.dataEpoch); assert.notEqual((await observe()).dataEpoch, current.dataEpoch)
  await snapshot('private-old-epoch-download'); await record(stage, { actualDownloads: [version.meta, beforeFile.meta, afterFile.meta], originalFormIds: { field: originalPrivate.field.id, guest: originalPrivate.guest.id, note: originalPrivate.note.id }, originalEpoch: current.dataEpoch, originalRevisionsRetained: true, deletedGuestInputBeforeRestore: true, deletedGuestPreparedViaAuthenticatedCommand: true, oldEpochInputAfterRestore: true, exportAddedReceipts: 0 })
  report.status = 'passed'
} catch (error) { report.status = 'failed'; report.failedStage = stage; report.failureType = error.name; const line = String(error.stack).match(/main-flow-process-recovery\.mjs:(\d+):/); if (line) report.failureLine = Number(line[1]); if (page) await snapshot('failure').catch(() => {}); process.exitCode = 1; console.error('FAIL ' + stage + ' (details redacted)') }
finally {
  await browser?.close().catch(() => {}); if (processHandle && processHandle.exitCode === null && !processHandle.signalCode) { const stopped = new Promise(resolve => processHandle.once('exit', resolve)); processHandle.kill('SIGKILL'); await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]) }
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM')
  if (profile && (!processHandle || processHandle.exitCode !== null || processHandle.signalCode)) await rm(profile, { recursive: true, force: true })
  report.finishedAt = new Date().toISOString(); if (file) { await file.truncate(0); await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); await file.close() }
}
