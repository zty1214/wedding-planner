// Real App + disposable local fixture; no cloud credentials, CDP, traces or HAR.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const port = 4196
const origin = `http://127.0.0.1:${port}`
const output = process.env.MAIN_FLOW_ARTIFACT_DIR
  ? resolve(process.env.MAIN_FLOW_ARTIFACT_DIR)
  : await mkdtemp(resolve(tmpdir(), 'planner-main-flow-e2e-'))
// An explicit directory must be fresh: never upload or overwrite prior-run evidence.
if (process.env.MAIN_FLOW_ARTIFACT_DIR) await mkdir(output, { recursive: false })
console.log('Artifacts: ' + output)
const results = []
let stage = 'startup', failureCode = 'BROWSER_ASSERTION_FAILED', browser, fixture, context, page
const report = { scope: 'real App + local fictitious gateway; isolated Chromium', baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), results }
async function wait(check, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw Error('CONDITION_TIMEOUT')
}
async function step(name, run) {
  stage = name
  const start = Date.now()
  await run()
  results.push({ name, status: 'passed', elapsedMs: Date.now() - start })
  console.log(`PASS ${name}`)
}
const button = (name, target = page) => target.getByRole('button', { name, exact: true })
async function navigate(label, target = page) {
  await target.getByRole('link', { name: label, exact: true }).click()
}
async function screenshot(name) {
  // Browser chrome/URL/clipboard/storage are never captured. Mask any access panel.
  await page.screenshot({ path: resolve(output, `main-flow-e2e-${name}.png`), fullPage: true, mask: [page.locator('input[type="password"]'), page.getByRole('region', { name: '协作链接管理' })] })
}
async function queueSummary(target = page) {
  return target.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('wedding-planner-fusion-drafts')
    request.onerror = () => reject(Error('QUEUE_READ_FAILED'))
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('outbox', 'readonly')
      const rows = tx.objectStore('outbox').getAll()
      tx.oncomplete = () => {
        resolve(rows.result.map(row => ({ operationId: row.command.operationId, type: row.command.type })))
        db.close()
      }
      tx.onabort = () => { db.close(); reject(Error('QUEUE_READ_FAILED')) }
    }
  }))
}
async function serverRead(target, link) {
  // Read-only normal gateway API. Secret remains inside the isolated page/closure.
  return target.evaluate(async link => {
    const url = new URL(link)
    const response = await fetch('/__sol_s03_gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key') }) })
    const result = await response.json()
    if (!result.ok) throw Error('LOCAL_SERVER_READ_FAILED')
    return { data: { guests: Object.values(result.value.data.guests), tables: Object.values(result.value.data.tables), rooms: Object.values(result.value.data.rooms) }, notes: result.value.notes, snapshotRevision: result.value.snapshotRevision }
  }, link)
}
async function addGuest(name, phone = '') {
  await page.getByLabel('宾客姓名', { exact: true }).fill(name)
  await page.getByLabel('宾客电话', { exact: true }).fill(phone)
  await button('添加').click()
  await wait(async () => await page.getByLabel(`${name}的住宿需求`).count() === 1)
}
async function night(year, month, day) {
  await button('添加日期').click()
  const heading = page.getByText(/^[0-9]{4} 年 [0-9]+ 月$/)
  for (let i = 0; i < 48; i++) {
    const match = (await heading.textContent()).match(/([0-9]+) 年 ([0-9]+) 月/)
    const delta = year * 12 + month - (Number(match[1]) * 12 + Number(match[2]))
    if (!delta) break
    await heading.locator('..').getByRole('button').nth(delta > 0 ? 1 : 0).click()
  }
  assert.equal(await heading.textContent(), `${year} 年 ${month} 月`)
  await heading.locator('../..').getByRole('button', { name: String(day), exact: true }).click()
}
async function verifyNights(target = page, shared = true) {
  for (const [label, room] of [['12.31', shared ? '03' : '01'], ['1.1', shared ? '03' : '02']]) {
    await target.getByRole('button', { name: label, exact: true }).click()
    await wait(async () => (await target.getByText('当晚安排人数', { exact: true }).locator('..').innerText()).split('\n')[0] === (shared ? '2' : '1'))
    assert.equal((await target.getByText('当晚房间数', { exact: true }).locator('..').innerText()).split('\n')[0], '1')
    assert.deepEqual(await target.getByLabel('房号', { exact: true }).evaluateAll(inputs => inputs.map(input => input.value)), [room])
  }
  await target.getByRole('button', { name: '全部', exact: true }).first().click()
}

try {
  // Never attach to or stop a pre-existing 4196 service.
  await new Promise((res, rej) => {
    const probe = createServer()
    probe.once('error', () => { failureCode = 'PORT_4196_UNAVAILABLE'; rej(Error(failureCode)) })
    probe.listen(port, '127.0.0.1', () => probe.close(res))
  })
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
  failureCode = 'PLAYWRIGHT_MODULE_UNAVAILABLE'
  const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright')
  failureCode = 'FIXTURE_START_FAILED'
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/sol-s03-main-flow.mjs'], { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, S03_PORT: String(port) } })
  let fixtureStopped = false
  fixture.once('exit', () => { fixtureStopped = true })
  await wait(async () => {
    if (fixtureStopped) throw Error('FIXTURE_START_FAILED')
    try { return (await fetch(`${origin}/fusion`)).ok } catch { return false }
  })
  failureCode = 'CHROMIUM_LAUNCH_FAILED'
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  report.browserVersion = browser.version()
  failureCode = 'BROWSER_ASSERTION_FAILED'
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  // Bound the browser to this local fixture; no external requests/credentials.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  let collaborationLink
  await step('create-project', async () => {
    await page.goto(`${origin}/fusion`)
    await page.getByLabel('新项目名称').fill('自动回归虚构项目')
    await button('新建独立项目').click()
    await button('复制协作链接').click()
    await page.getByText('已在复制前核对有效协作链接，可分享给家人。', { exact: true }).waitFor()
    collaborationLink = await page.evaluate(() => navigator.clipboard.readText())
    assert.ok(collaborationLink.startsWith(`${origin}/fusion/p/`) && /#key=[a-f0-9]{64}$/.test(collaborationLink))
    await button('打开项目').click()
    await page.getByRole('link', { name: '宾客名单', exact: true }).waitFor()
  })
  await step('guests-leading-zero', async () => {
    await navigate('宾客名单')
    await addGuest('虚构甲', '00123456789')
    await addGuest('虚构乙')
    await page.getByText('00123456789', { exact: true }).waitFor()
    await screenshot('guests')
  })
  await step('seating-visible-canvas', async () => {
    await navigate('座位安排')
    stage = 'seating/add-table'
    await page.getByRole('button', { name: /10人.*点击添加到画布/ }).click()
    await page.getByText('桌数：1 桌', { exact: true }).waitFor()
    // Newly added table is centered in the visible canvas. Click the real canvas;
    // no React/Konva state or store mutation is used to select a table.
    stage = 'seating/select-canvas-table'
    await page.getByTitle('定位所有桌子', { exact: true }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const canvas = page.locator('.konvajs-content canvas').first()
    const box = await canvas.boundingBox()
    assert.ok(box && box.width > 0 && box.height > 0)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    stage = 'seating/edit-table-name'
    await page.getByLabel('桌名', { exact: true }).fill('虚构桌01')
    await button('保存桌名').click()
    stage = 'seating/assign-guest'
    await button('分配宾客').click()
    await page.getByRole('button', { name: /^虚构甲/ }).click()
    await page.getByText('10 人桌 · 已坐 1 人', { exact: false }).waitFor()
    await screenshot('seating')
  })
  await step('stay-room-nights', async () => {
    await navigate('住宿安排')
    await night(2026, 12, 31)
    await night(2027, 1, 1)
    async function arrange(names, dates) {
      await button('添加标间').click()
      const dialog = page.getByRole('dialog', { name: '房间住宿安排' })
      await dialog.getByText('选人及房间晚次后，一次确认保存。', { exact: true }).waitFor()
      for (const name of names) await dialog.locator('label').filter({ hasText: name }).getByRole('checkbox').check()
      for (const date of dates) await dialog.getByRole('checkbox', { name: date, exact: true }).check()
      await dialog.getByRole('button', { name: '确认整批安排', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.locator('.planner-sync[data-state="synced"]').waitFor()
    }
    await arrange(['虚构甲'], ['2026-12-31'])
    await arrange(['虚构乙'], ['2027-01-01'])
    await verifyNights(page, false)
    const split = await serverRead(page, collaborationLink)
    assert.deepEqual(split.data.rooms.map(room => [room.label, room.stayDates]), [['01', ['2026-12-31']], ['02', ['2027-01-01']]])
    await arrange(['虚构甲', '虚构乙'], ['2026-12-31', '2027-01-01'])
    await verifyNights()
    const shared = await serverRead(page, collaborationLink), room = shared.data.rooms.find(room => room.label === '03')
    assert.deepEqual(room.stayDates, ['2026-12-31', '2027-01-01'])
    assert.ok(shared.data.guests.every(guest => guest.roomId === room.id && guest.attendance === 'pending'))
    report.roomNights = { independentRoomsByNight: true, sharedRoomCountsOnceEachNight: true, emptyPreviousRoomsExcluded: true, attendancePreserved: true }
    await screenshot('stay')
  })
  await step('notes-and-refresh', async () => {
    await navigate('备婚笔记')
    await button('酒店').click()
    await button('写笔记').click()
    await page.getByLabel('笔记标题').fill('跨年安排')
    await page.getByLabel('笔记正文').fill('仅本机虚构自动回归')
    stage = 'notes/publish'
    await button('发布').click()
    await page.getByText('仅本机虚构自动回归', { exact: true }).waitFor()
    await wait(async () => (await serverRead(page, collaborationLink)).notes.some(note => note.title === '跨年安排' && note.content === '仅本机虚构自动回归'))
    await wait(async () => (await queueSummary()).length === 0)
    stage = 'notes/refresh'
    await page.reload()
    await button('酒店').click()
    await page.getByText('仅本机虚构自动回归', { exact: true }).waitFor()
    await screenshot('notes')
    stage = 'notes/recheck-modules'
    await navigate('宾客名单')
    await page.getByText('00123456789', { exact: true }).waitFor()
    await navigate('住宿安排')
    await verifyNights()
    assert.deepEqual(await page.getByLabel('房号', { exact: true }).evaluateAll(inputs => inputs.map(input => input.value)), ['01', '02', '03'])
    await navigate('座位安排')
    await page.getByTitle('定位所有桌子', { exact: true }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const canvas = await page.locator('.konvajs-content canvas').first().boundingBox()
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    assert.equal(await page.getByLabel('桌名', { exact: true }).inputValue(), '虚构桌01')
    await page.getByText('10 人桌 · 已坐 1 人', { exact: false }).waitFor()
  })
  await step('same-context-shared-queue', async () => {
    stage = 'shared-queue/open-second-tab'
    const second = await context.newPage()
    await second.goto(collaborationLink.replace('/seating', '/guests'))
    await second.getByLabel('虚构甲的住宿需求').waitFor()
    await navigate('宾客名单')
    await wait(async () => (await queueSummary()).length === 0)
    stage = 'shared-queue/offline-add'
    await context.setOffline(true)
    await addGuest('共享队列虚构丙')
    await wait(async () => (await queueSummary()).length === 1)
    stage = 'shared-queue/read-two-tabs'
    const queued = await queueSummary()
    assert.equal(queued.length, 1)
    assert.deepEqual(await queueSummary(second), queued)
    report.sharedQueue = { operationId: queued[0].operationId, offlinePending: queued.length }
    stage = 'shared-queue/reconnect'
    await context.setOffline(false)
    stage = 'shared-queue/reload-second'
    await second.reload()
    stage = 'shared-queue/resume-second'
    const resume = button('确认并继续同步', second)
    await second.getByRole('link', { name: '宾客名单', exact: true }).waitFor()
    if (await resume.isVisible()) await resume.click()
    stage = 'shared-queue/wait-visible-second'
    await wait(async () => await second.getByLabel('共享队列虚构丙的住宿需求').count() === 1)
    stage = 'shared-queue/wait-server'
    await wait(async () => (await serverRead(second, collaborationLink)).data.guests.some(g => g.name === '共享队列虚构丙'))
    await wait(async () => (await queueSummary(second)).length === 0)
    stage = 'shared-queue/close-first-tab'
    await page.close()
    page = second
    await page.reload()
    await page.getByLabel('共享队列虚构丙的住宿需求').waitFor()
    await wait(async () => (await queueSummary()).length === 0)
    const sharedRead = await serverRead(page, collaborationLink)
    assert.equal(sharedRead.data.guests.filter(g => g.name === '共享队列虚构丙').length, 1)
    report.sharedQueue.afterReconnectPending = 0
    report.sharedQueue.serverGuestCount = 1
    await screenshot('shared-queue')
  })
  await step('independent-context-local-collaboration', async () => {
    const independent = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await independent.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const other = await independent.newPage()
    const stayLink = new URL(collaborationLink); stayLink.pathname = stayLink.pathname.replace(/\/(seating|guests)$/, '/stay'); await other.goto(stayLink.href)
    await verifyNights(other)
    assert.equal((await queueSummary(other)).length, 0)
    await navigate('宾客名单', other)
    await other.getByLabel('宾客姓名', { exact: true }).fill('独立协作虚构丁')
    await other.getByLabel('宾客电话', { exact: true }).fill('00012345678')
    await button('添加', other).click()
    await other.getByLabel('独立协作虚构丁的住宿需求').waitFor()
    await wait(async () => (await serverRead(other, collaborationLink)).data.guests.some(g => g.name === '独立协作虚构丁' && g.phone === '00012345678'))
    await wait(async () => (await queueSummary(other)).length === 0)
    await page.reload()
    await page.getByLabel('独立协作虚构丁的住宿需求').waitFor()
    await page.getByText('00012345678', { exact: true }).waitFor()
    const finalRead = await serverRead(other, collaborationLink)
    assert.equal(finalRead.data.guests.length, 4)
    assert.equal(finalRead.data.guests.filter(g => g.name === '独立协作虚构丁').length, 1)
    report.serverFinal = { guests: finalRead.data.guests.length, tables: finalRead.data.tables.length, rooms: finalRead.data.rooms.length, notes: finalRead.notes.length, snapshotRevision: finalRead.snapshotRevision }
    await independent.close()
    await screenshot('collaboration')
  })
  report.status = 'passed'
} catch {
  if (page && stage !== 'startup') await screenshot('failure').catch(() => {})
  report.status = 'failed'
  report.failedStage = stage
  // Do not serialize Playwright errors: they can include a secret-bearing URL.
  results.push({ name: stage, status: 'failed', reason: failureCode })
  console.error(`FAIL ${stage} (details deliberately redacted)`)
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (fixture && fixture.exitCode === null) {
    fixture.kill('SIGTERM')
    await Promise.race([new Promise(r => fixture.once('exit', r)), new Promise(r => setTimeout(r, 3000))])
    if (fixture.exitCode === null) fixture.kill('SIGKILL')
  }
  report.finishedAt = new Date().toISOString()
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'main-flow-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
