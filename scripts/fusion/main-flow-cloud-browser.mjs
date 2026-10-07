// Real App + dev CloudBase in isolated storage; public SDK config only, no traces or HAR.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const [configPath, manifestPath, outputPath] = process.argv.slice(2)
if (!configPath || !manifestPath || !outputPath) throw Error('Provide public config path, deployment manifest and fresh artifact directory')
import { functionDetail } from './cloudbase-cli.mjs'
const port = 4197
const origin = `http://127.0.0.1:${port}`
const output = resolve(outputPath)
const results = []
let reportOwned = false
let otherPage, collaborationLink, managementLink
let stage = 'startup', failureCode = 'BROWSER_ASSERTION_FAILED', browser, fixture, context, page
const report = { scope: 'real App + real dev CloudBase gateway; two isolated Chromium storage contexts', baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), results }
function deadline(task) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('SDK_OBSERVATION_TIMEOUT')), 30000)
    task.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
async function wait(check, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw Error('CONDITION_TIMEOUT')
}
async function step(name, run) {
  stage = name
  report.status = 'running'; report.currentStage = stage
  await writeFile(resolve(output, 'cloud-browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const start = Date.now()
  await run()
  results.push({ name, status: 'passed', elapsedMs: Date.now() - start })
  await writeFile(resolve(output, 'cloud-browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
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
        resolve(rows.result.map(row => ({ operationId: row.command.operationId, type: row.command.type, status: row.status })))
        db.close()
      }
      tx.onabort = () => { db.close(); reject(Error('QUEUE_READ_FAILED')) }
    }
  }))
}
async function serverRead(target, link) {
  // Read-only normal gateway API. Secret remains inside the isolated page/closure.
  return deadline(target.evaluate(async link => {
    const url = new URL(link)
    const { connectGateway } = await import('/src/fusion/cloudClient.ts')
    const call = await connectGateway()
    const result = await call({ action: 'read', projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key') })
    if (!result.ok) throw Error('LOCAL_SERVER_READ_FAILED')
    return { data: { guests: Object.values(result.value.data.guests), tables: Object.values(result.value.data.tables), rooms: Object.values(result.value.data.rooms) }, notes: result.value.notes, snapshotRevision: result.value.snapshotRevision, configuredNights: result.value.data.config.stayDates, notesRevision: result.value.notesRevision, dataEpoch: result.value.dataEpoch, role: result.value.role }
  }, link))
}
async function action(target, link, name, extra = {}) {
  return deadline(target.evaluate(async ({ link, name, extra }) => {
    const url = new URL(link), call = await (await import('/src/fusion/cloudClient.ts')).connectGateway()
    return call({ action: name, projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key'), ...extra })
  }, { link, name, extra }))
}
async function queueCommands(target) {
  return target.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wedding-planner-fusion-drafts')
    open.onerror = () => reject(Error('QUEUE_READ_FAILED'))
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('outbox', 'readonly'), request = tx.objectStore('outbox').getAll()
      tx.oncomplete = () => { resolve(request.result.map(row => row.command)); db.close() }
      tx.onabort = () => { db.close(); reject(Error('QUEUE_READ_FAILED')) }
    }
  }))
}
async function selectTable(target) {
  await navigate('座位安排', target)
  await target.getByTitle('定位所有桌子', { exact: true }).click()
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const box = await target.locator('.konvajs-content canvas').first().boundingBox()
  assert.ok(box)
  await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await target.getByLabel('桌名', { exact: true }).waitFor()
}
async function addGuest(name, phone = '') {
  await page.getByLabel('宾客姓名', { exact: true }).fill(name)
  await page.getByLabel('宾客电话', { exact: true }).fill(phone)
  await button('添加').click()
  await wait(async () => await page.getByLabel(`${name}的住宿需求`).count() === 1)
  await wait(async () => (await serverRead(page, collaborationLink)).data.guests.some(g => g.name === name))
  await page.getByText('已同步到云端', { exact: true }).waitFor()
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
  stage = `stay/add-night-${year}-${month}-${day}`
  await heading.locator('../..').getByRole('button', { name: String(day), exact: true }).click()
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  await wait(async () => (await serverRead(page, collaborationLink)).configuredNights.includes(date))
  await page.getByText('已同步到云端', { exact: true }).waitFor()
}
async function verifyNights(target = page, interactiveFilters = true) {
  for (const [name, date, pressed] of [['虚构甲', '2026-12-31', 'true'], ['虚构甲', '2027-01-01', 'true'], ['虚构乙', '2026-12-31', 'false'], ['虚构乙', '2027-01-01', 'true']]) {
    await wait(async () => await target.getByRole('button', { name: `${name}住宿${date}`, exact: true }).getAttribute('aria-pressed') === pressed)
  }
  if (!interactiveFilters) return
  for (const [label, people] of [['12.31', '1'], ['1.1', '2']]) {
    await target.getByRole('button', { name: label, exact: true }).click()
    await wait(async () => (await target.getByText('当晚总人数', { exact: true }).locator('..').innerText()).split('\n')[0] === people)
    assert.equal((await target.getByText('当晚房间数', { exact: true }).locator('..').innerText()).split('\n')[0], '1')
  }
  await target.getByRole('button', { name: '全部', exact: true }).first().click()
}
try {
  await mkdir(output, { recursive: true })
  // Require a fresh report destination; never overwrite previous cloud evidence.
  await writeFile(resolve(output, 'cloud-browser-report.json'), '{}\n', { flag: 'wx' }); reportOwned = true
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.env, 'dev-d1gh3jw1gdf06af22')
  assert.equal(manifest.functionName, 'planner-fusion-gateway-probe')
  const detail = functionDetail(manifest.env, manifest.functionName)
  assert.equal(detail.Status, 'Active')
  const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
  assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
  assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(','))
  report.deployment = { env: manifest.env, functionName: manifest.functionName, active: true, eventLoggingDisabled: true, manifestBundleSha256: manifest.sha256, bundleContentRehashed: false }
  // Never attach to or stop a pre-existing 4196 service.
  await new Promise((res, rej) => {
    const probe = createServer()
    probe.once('error', () => { failureCode = 'PORT_4197_UNAVAILABLE'; rej(Error(failureCode)) })
    probe.listen(port, '127.0.0.1', () => probe.close(res))
  })
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
  failureCode = 'PLAYWRIGHT_MODULE_UNAVAILABLE'
  const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright')
  failureCode = 'FIXTURE_START_FAILED'
  fixture = spawn(process.execPath, ['--experimental-strip-types', 'scripts/fusion/main-flow-cloud-preview.mjs', configPath], { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, S03_PORT: String(port) } })
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
  page.setDefaultTimeout(45000)
  await step('create-project', async () => {
    await page.goto(`${origin}/fusion`)
    await page.getByLabel('新项目名称').waitFor()
    // Warm the dev-only SDK dependency graph before persisting a creation request.
    // This is an invalid read-only probe, not a new project or a creation retry.
    let warmup
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        warmup = await deadline(page.evaluate(async () => {
          const call = await (await import('/src/fusion/cloudClient.ts')).connectGateway()
          return call({ action: 'project.create', request: null })
        }))
        break
      } catch (error) {
        if (attempt !== 0 || !String(error.message).includes('Execution context was destroyed')) throw error
        report.devSdkWarmupReloadObserved = true
        await page.waitForLoadState('domcontentloaded')
      }
    }
    assert.deepEqual(warmup, { ok: false, error: { code: 'INVALID_INPUT' } })
    await page.reload()
    await page.getByLabel('新项目名称').fill('自动回归虚构项目')
    await button('新建独立项目').click()
    stage = 'create-project/await-confirmation'
    await button('复制协作链接').click()
    collaborationLink = await page.evaluate(() => navigator.clipboard.readText())
    assert.ok(collaborationLink.startsWith(`${origin}/fusion/p/`) && /#key=[a-f0-9]{64}$/.test(collaborationLink))
    await button('复制管理链接').click()
    managementLink = await page.evaluate(() => navigator.clipboard.readText())
    assert.ok(managementLink.startsWith(origin) && managementLink !== collaborationLink)
    report.fixtureProjectId = new URL(collaborationLink).pathname.split('/')[3]
    await button('打开项目').click()
    await page.getByRole('link', { name: '宾客名单', exact: true }).waitFor()
  })
  await step('guests-leading-zero', async () => {
    await navigate('宾客名单')
    await addGuest('虚构甲', '00123456789')
    await addGuest('虚构乙')
    for (const name of ['虚构甲', '虚构乙']) await page.getByLabel(`${name}的住宿需求`).selectOption('needed')
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
    await wait(async () => (await serverRead(page, managementLink)).data.tables[0].label === '虚构桌01')
    await page.getByText('已同步到云端', { exact: true }).waitFor()
    stage = 'seating/assign-guest'
    await button('分配宾客').click()
    await page.getByRole('button', { name: /^虚构甲/ }).click()
    await page.getByText('10 人桌 · 已坐 1 人', { exact: false }).waitFor()
    await screenshot('seating')
  })
  await step('stay-different-nights', async () => {
    await navigate('住宿安排')
    await button('添加标间').click()
    await page.getByLabel('房号', { exact: true }).fill('001')
    await button('保存房号').click()
    await wait(async () => (await serverRead(page, managementLink)).data.rooms[0].label === '001')
    await page.getByText('已同步到云端', { exact: true }).waitFor()
    await button('添加宾客').click()
    for (const name of ['虚构甲', '虚构乙']) {
      await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: '安排住宿', exact: true }).click()
      await wait(async () => !!(await serverRead(page, managementLink)).data.guests.find(g => g.name === name).roomId)
      await page.getByText('已同步到云端', { exact: true }).waitFor()
    }
    await button('关闭宾客选择').click()
    await night(2026, 12, 31)
    await night(2027, 1, 1)
    for (const [name, date] of [['虚构甲', '2026-12-31'], ['虚构甲', '2027-01-01'], ['虚构乙', '2027-01-01']]) {
      await button(`${name}住宿${date}`).click()
      await wait(async () => await button(`${name}住宿${date}`).getAttribute('aria-pressed') === 'true')
      await wait(async () => (await serverRead(page, managementLink)).data.guests.find(g => g.name === name).stayDates.includes(date))
      await page.getByText('已同步到云端', { exact: true }).waitFor()
    }
    await verifyNights()
    await screenshot('stay')
  })
  await step('notes-and-refresh', async () => {
    await navigate('备婚笔记')
    await button('酒店').click()
    await button('写笔记').click()
    await page.getByLabel('笔记标题').fill('跨年安排')
    await page.getByLabel('笔记正文').fill('真实开发网关虚构浏览器验收')
    stage = 'notes/publish'
    await button('发布').click()
    await page.getByText('真实开发网关虚构浏览器验收', { exact: true }).waitFor()
    await wait(async () => (await serverRead(page, collaborationLink)).notes.some(note => note.title === '跨年安排' && note.content === '真实开发网关虚构浏览器验收'))
    await wait(async () => (await queueSummary()).length === 0)
    stage = 'notes/refresh'
    await page.reload()
    await button('酒店').click()
    await page.getByText('真实开发网关虚构浏览器验收', { exact: true }).waitFor()
    await screenshot('notes')
    stage = 'notes/recheck-modules'
    await navigate('宾客名单')
    await page.getByText('00123456789', { exact: true }).waitFor()
    await navigate('住宿安排')
    await verifyNights()
    assert.equal(await page.getByLabel('房号', { exact: true }).inputValue(), '001')
    await navigate('座位安排')
    await page.getByTitle('定位所有桌子', { exact: true }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const canvas = await page.locator('.konvajs-content canvas').first().boundingBox()
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    assert.equal(await page.getByLabel('桌名', { exact: true }).inputValue(), '虚构桌01')
    await page.getByText('10 人桌 · 已坐 1 人', { exact: false }).waitFor()
  })
  await step('independent-browser-cloud-four-modules', async () => {
    const independent = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const other = await independent.newPage(); otherPage = other
    await other.goto(collaborationLink.replace('/seating', '/stay'))
    stage = 'cloud/verify-nights'
    await verifyNights(other)
    assert.equal(await other.getByLabel('房号', { exact: true }).inputValue(), '001')
    const identity = target => target.evaluate(async () => (await import('/src/fusion/cloudClient.ts')).reviewIdentity())
    stage = 'cloud/identity'
    const a = await identity(page), b = await identity(other)
    assert.ok(typeof a === 'string' && a.length && typeof b === 'string' && b.length && a !== b)
    report.identitiesDistinct = true
    assert.equal((await queueSummary(other)).length, 0)
    stage = 'cloud/role-and-snapshot'
    const remote = await serverRead(other, collaborationLink)
    assert.equal(remote.role, 'collaboration')
    assert.equal(remote.data.guests.length, 2)
    assert.equal(remote.data.tables.length, 1)
    assert.equal(remote.notes.length, 1)
    stage = 'cloud/notes-ui'
    await navigate('备婚笔记', other)
    await button('酒店', other).click()
    await other.getByText('真实开发网关虚构浏览器验收', { exact: true }).waitFor()
    await navigate('宾客名单', other)
    await other.getByText('00123456789', { exact: true }).waitFor()
    stage = 'cloud/add-from-collaborator'
    await other.getByLabel('宾客姓名', { exact: true }).fill('独立云端虚构丙')
    await button('添加', other).click()
    await wait(async () => (await serverRead(other, collaborationLink)).data.guests.some(g => g.name === '独立云端虚构丙'))
    await wait(async () => (await queueSummary(other)).length === 0)
    stage = 'cloud/manager-refresh'
    await page.reload()
    await navigate('宾客名单')
    await page.getByLabel('独立云端虚构丙的住宿需求').waitFor()
    stage = 'cloud/same-record-conflict'
    await selectTable(other)
    await other.getByLabel('桌名', { exact: true }).fill('冲突的虚构原桌名')
    await selectTable(page)
    await page.getByLabel('桌名', { exact: true }).fill('管理端已确认桌名')
    await button('保存桌名').click()
    await wait(async () => (await serverRead(page, managementLink)).data.tables[0].label === '管理端已确认桌名')
    await button('保存桌名', other).click()
    await wait(async () => (await queueSummary(other)).length === 1)
    await other.getByText('冲突待处理，本地草稿保留（1 项）', { exact: true }).waitFor()
    const conflicted = (await queueCommands(other))[0]
    assert.equal(conflicted.type, 'table.update')
    assert.equal(conflicted.payload.patch.label, '冲突的虚构原桌名')
    const beforeArchive = await serverRead(page, managementLink)
    await button('查看本机草稿', other).click()
    await button('保留原草稿，开始重新编辑', other).click()
    await button('核对云端并保留，开始重新编辑', other).click()
    await wait(async () => (await queueSummary(other)).length === 0)
    assert.equal((await serverRead(page, managementLink)).snapshotRevision, beforeArchive.snapshotRevision)
    await other.reload()
    await button('查看本机草稿', other).click()
    await other.locator('summary').filter({ hasText: '1 项原草稿' }).click()
    const downloaded = other.waitForEvent('download')
    await button('导出这组原草稿', other).click()
    const file = await downloaded
    await file.saveAs(resolve(output, 'cloud-retained-conflict.json'))
    const retained = JSON.parse(await readFile(resolve(output, 'cloud-retained-conflict.json'), 'utf8'))
    assert.equal(retained.drafts[0].command.operationId, conflicted.operationId)
    assert.equal(retained.drafts[0].command.payload.patch.label, '冲突的虚构原桌名')
    await other.getByRole('dialog', { name: '本机草稿' }).getByRole('button', { name: '关闭', exact: true }).click()
    await selectTable(other)
    await other.getByLabel('桌名', { exact: true }).fill('重新编辑确认桌名')
    await button('保存桌名', other).click()
    await wait(async () => (await serverRead(other, collaborationLink)).data.tables[0].label === '重新编辑确认桌名')
    await wait(async () => (await queueSummary(other)).length === 0)
    report.conflict = { operationId: conflicted.operationId, currentCloudValuePreserved: true, archiveSurvivesReload: true, actualDownloadReadback: true, archiveAddedCloudWrites: false, reeditPassed: true }
    stage = 'cloud/collaborator-version-save'
    await navigate('历史版本', other)
    await other.getByText('已同步到云端', { exact: true }).waitFor()
    await other.getByLabel('版本名称').fill('协作端保存的虚构恢复点')
    await button('保存当前版本', other).click()
    await other.getByText('已同步到云端', { exact: true }).waitFor()
    stage = 'cloud/collaborator-version-preview'
    await button('预览内容', other).click()
    await other.getByText('整项目恢复需要管理链接。', { exact: true }).waitFor()
    assert.equal(await button('恢复整个项目到此版本', other).count(), 0)
    stage = 'cloud/access-ui-permission'
    assert.equal(await button('协作链接', other).count(), 0)
    stage = 'cloud/restore-four-modules-before-change'
    const versions = await action(other, collaborationLink, 'history.list', { cursor: null, day: null })
    assert.equal(versions.ok, true)
    const versionId = versions.value.versions[0].id
    const target = await serverRead(page, managementLink)
    await navigate('宾客名单')
    await page.getByLabel('虚构甲的出席状态').selectOption('confirmed')
    await wait(async () => (await serverRead(page, managementLink)).data.guests.find(g => g.name === '虚构甲').attendance === 'confirmed')
    await selectTable(page)
    await page.getByLabel('桌名', { exact: true }).fill('恢复前变更桌名')
    await button('保存桌名').click()
    await wait(async () => (await serverRead(page, managementLink)).data.tables[0].label === '恢复前变更桌名')
    stage = 'cloud/restore-real-seat-change'
    await page.locator('[draggable="true"]').filter({ hasText: '虚构甲' }).getByTitle('移除', { exact: true }).click()
    await wait(async () => (await serverRead(page, managementLink)).data.guests.find(g => g.name === '虚构甲').tableId === null)
    await button('分配宾客').click()
    await page.getByRole('button', { name: /^虚构乙/ }).click()
    await wait(async () => (await serverRead(page, managementLink)).data.guests.find(g => g.name === '虚构乙').seatIndex === 0)
    await page.getByRole('button', { name: /^虚构甲/ }).click()
    await wait(async () => (await serverRead(page, managementLink)).data.guests.find(g => g.name === '虚构甲').seatIndex === 1)
    const seatingBeforeRestore = (await serverRead(page, managementLink)).data.guests.map(g => [g.id, g.tableId, g.seatIndex])
    const targetSeating = target.data.guests.map(g => [g.id, g.tableId, g.seatIndex])
    assert.notDeepEqual(seatingBeforeRestore, targetSeating)

    await navigate('住宿安排')
    await button('虚构甲住宿2026-12-31').click()
    await wait(async () => !(await serverRead(page, managementLink)).data.guests.find(g => g.name === '虚构甲').stayDates.includes('2026-12-31'))
    await navigate('备婚笔记')
    await button('酒店').click()
    await button('编辑').click()
    await page.getByLabel('笔记正文').fill('恢复前变更笔记正文')
    await button('保存修改').click()
    await wait(async () => (await serverRead(page, managementLink)).notes[0].content === '恢复前变更笔记正文')
    await wait(async () => (await queueSummary()).length === 0)
    await navigate('宾客名单', other)
    await independent.setOffline(true)
    await other.getByLabel('宾客姓名').fill('恢复后不得重发的旧草稿')
    await button('添加', other).click()
    await wait(async () => (await queueSummary(other)).length === 1)
    const oldCommand = (await queueCommands(other))[0]
    assert.equal(oldCommand.dataEpoch, target.dataEpoch)
    stage = 'cloud/restore-submit-lost-response'
    await navigate('历史版本')
    await button('预览内容').click()
    await button('恢复整个项目到此版本').click()
    await page.evaluate(async () => (await import('/src/fusion/cloudClient.ts')).reviewLoseNext('version.restore'))
    await button('确认替换并保留安全版本').click()
    await wait(async () => (await queueCommands(page)).some(c => c.type === 'version.restore'))
    await page.getByText('云端结果待确认，本地草稿保留（1 项）', { exact: true }).waitFor()
    const restoreCommand = (await queueCommands(page))[0]
    const committed = await serverRead(page, managementLink)
    assert.notEqual(committed.dataEpoch, target.dataEpoch)
    assert.equal(committed.data.tables[0].label, target.data.tables[0].label)
    assert.deepEqual(committed.data.guests.map(g => [g.id, g.attendance, g.stayDates, g.tableId, g.seatIndex, g.roomId]), target.data.guests.map(g => [g.id, g.attendance, g.stayDates, g.tableId, g.seatIndex, g.roomId]))
    assert.equal(committed.notes[0].content, target.notes[0].content)
    const receipt = await action(page, managementLink, 'receipt', { dataEpoch: restoreCommand.dataEpoch, operationId: restoreCommand.operationId })
    assert.equal(receipt.ok, true)
    assert.ok(receipt.value)
    assert.equal(receipt.value.operationId, restoreCommand.operationId)
    assert.equal(receipt.value.dataEpoch, restoreCommand.dataEpoch)
    assert.equal(receipt.value.resultDataEpoch, committed.dataEpoch)
    assert.ok(/^[a-f0-9]{64}$/.test(receipt.value.requestDigest))
    stage = 'cloud/restore-reopen-original-request'
    await page.reload()
    await button('确认并继续同步').click()
    await wait(async () => (await queueSummary()).length === 0)
    const reconfirmed = await serverRead(page, managementLink)
    assert.equal(reconfirmed.dataEpoch, committed.dataEpoch)
    assert.deepEqual(reconfirmed.data.guests.map(g => [g.id, g.tableId, g.seatIndex]), targetSeating)
    const afterVersions = await action(page, managementLink, 'history.list', { cursor: null, day: null })
    assert.equal(afterVersions.ok, true)
    assert.equal(afterVersions.value.versions.filter(v => v.name === '整项目恢复前的安全版本').length, 1)
    await independent.setOffline(false)
    await other.reload()
    await button('确认并继续同步', other).click()
    await other.getByText('冲突待处理，本地草稿保留（1 项）', { exact: true }).waitFor()
    assert.equal((await queueCommands(other))[0].operationId, oldCommand.operationId)
    assert.equal((await serverRead(page, managementLink)).data.guests.some(g => g.name === '恢复后不得重发的旧草稿'), false)
    const afterOldAttempt = await serverRead(other, collaborationLink)
    assert.equal(afterOldAttempt.dataEpoch, committed.dataEpoch)
    await button('查看本机草稿', other).click()
    await button('保留原草稿，开始重新编辑', other).click()
    await button('核对云端并保留，开始重新编辑', other).click()
    await wait(async () => (await queueSummary(other)).length === 0)
    await other.getByRole('dialog', { name: '本机草稿' }).getByRole('button', { name: '关闭', exact: true }).click()
    report.restore = { targetVersionId: versionId, originalOperationId: restoreCommand.operationId, oldDraftOperationId: oldCommand.operationId, fourModulesMatchTarget: true, realSeatChange: { target: targetSeating, beforeRestore: seatingBeforeRestore, restored: reconfirmed.data.guests.map(g => [g.id, g.tableId, g.seatIndex]) }, confirmedNewEpochNotRepeated: true, safetyVersionCount: 1, oldDraftPreservedAndNotExecuted: true, mode: 'real cloud + client lost-response injection' }
    await screenshot('cloud-collaboration')
    await navigate('宾客名单', other)
    await independent.setOffline(true)
    await other.getByLabel('宾客姓名').fill('撤权后应保留的虚构草稿')
    await button('添加', other).click()
    await wait(async () => (await queueCommands(other)).length === 1)
    const revokedDraft = (await queueCommands(other))[0]
    await context.clearPermissions()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    stage = 'cloud/rotation-prepare'
    await button('协作链接').click()
    await button('准备新协作链接').click()
    stage = 'cloud/rotation-confirm-copy'
    await button('确认更换并复制链接').click()
    await page.getByText('已重新核对并复制有效协作链接。', { exact: true }).waitFor()
    const nextLink = await page.evaluate(() => navigator.clipboard.readText())
    assert.ok(nextLink.startsWith(origin) && nextLink !== collaborationLink && nextLink !== managementLink)
    await button('关闭').click()
    stage = 'cloud/revoked-session-refresh'
    await independent.setOffline(false)
    await button('刷新项目', other).click()
    await other.getByText('无权访问，本地草稿保留（1 项）', { exact: true }).waitFor()
    stage = 'cloud/old-link-api-read'
    const rejected = await other.evaluate(async link => {
      const url = new URL(link), call = await (await import('/src/fusion/cloudClient.ts')).connectGateway()
      const input = { projectId: url.pathname.split('/')[3], secret: new URLSearchParams(url.hash.slice(1)).get('key') }
      return await call({ action: 'read', ...input })
    }, collaborationLink)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, 'FORBIDDEN')
    const deniedWrite = await action(other, collaborationLink, 'execute', { command: { projectId: report.fixtureProjectId, dataEpoch: committed.dataEpoch, operationId: randomUUID(), commandVersion: 1, type: 'guest.add', payload: { id: randomUUID(), name: '旧链接不得新增', group: '新郎亲属', phone: '' }, expectedRevisions: {} } })
    assert.equal(deniedWrite.ok, false)
    assert.equal(deniedWrite.error.code, 'FORBIDDEN')
    assert.equal((await queueCommands(other))[0].operationId, revokedDraft.operationId)
    stage = 'cloud/new-link-join'
    await other.goto(nextLink.replace('/guests', '/stay'))
    stage = 'cloud/new-link-readonly-with-pending-draft'
    await verifyNights(other, false)
    await other.reload()
    await verifyNights(other, false)
    assert.equal((await queueCommands(other))[0].operationId, revokedDraft.operationId)
    assert.equal((await queueSummary(other))[0].status, 'forbidden')
    await button('查看本机草稿', other).click()
    await button('保留原草稿，开始重新编辑', other).click()
    await button('核对云端并保留，开始重新编辑', other).click()
    await wait(async () => (await queueSummary(other)).length === 0)
    await other.getByRole('dialog', { name: '本机草稿' }).getByRole('button', { name: '关闭', exact: true }).click()
    await verifyNights(other)
    const finalRead = await serverRead(page, managementLink)
    assert.equal(finalRead.data.guests.some(g => g.name === '旧链接不得新增' || g.name === '撤权后应保留的虚构草稿'), false)
    report.rotation = { copiedThroughProduct: true, oldSessionReadDenied: true, oldLinkWriteDenied: true, oldDraftOperationId: revokedDraft.operationId, oldDraftSurvivesNewLinkAndReopen: true, newLinkReopenPassed: true }
    report.serverFinal = { guests: finalRead.data.guests.length, tables: finalRead.data.tables.length, rooms: finalRead.data.rooms.length, notes: finalRead.notes.length, dataEpoch: finalRead.dataEpoch }
    stage = 'cloud/project-switch-private-draft-isolation'
    await page.getByLabel('项目标题', { exact: true }).fill('仅第一项目私有标题草稿')
    await page.getByText('已保存在本机，尚未提交。', { exact: true }).waitFor()
    await page.getByRole('link', { name: '我的项目', exact: true }).click()
    await page.getByLabel('新项目名称').fill('切换隔离虚构项目')
    await button('新建独立项目').click()
    const secondProject = page.getByRole('heading', { name: '切换隔离虚构项目', exact: true }).locator('..')
    await secondProject.getByRole('button', { name: '复制管理链接', exact: true }).click()
    const secondLink = await page.evaluate(() => navigator.clipboard.readText())
    report.switchProjectId = new URL(secondLink).pathname.split('/')[3]
    await secondProject.getByRole('button', { name: '打开项目', exact: true }).click()
    await page.getByLabel('项目标题').waitFor()
    assert.equal(await page.getByLabel('项目标题').inputValue(), '切换隔离虚构项目')
    const secondRead = await serverRead(page, secondLink)
    assert.equal(secondRead.data.guests.length, 0)
    assert.equal(secondRead.data.tables.length, 0)
    assert.equal(secondRead.data.rooms.length, 0)
    assert.equal(secondRead.notes.length, 0)
    assert.equal(await page.getByText('仅第一项目私有标题草稿', { exact: true }).count(), 0)
    await page.goto(managementLink)
    await navigate('宾客名单')
    await page.getByText('00123456789', { exact: true }).waitFor()
    await page.locator('summary').filter({ hasText: '恢复本机项目标题草稿' }).click()
    await page.getByRole('button', { name: /^仅第一项目私有标题草稿/ }).click()
    await wait(async () => await page.getByLabel('项目标题').inputValue() === '仅第一项目私有标题草稿')
    report.projectSwitch = { cloudDataIsolated: true, privateDraftAbsentFromOtherProject: true, originalPrivateInputRecoverable: true }
    await independent.close()
  })
  report.status = 'passed'
} catch (error) {
  report.failureType = error.name
  report.executionContextDestroyed = String(error.message).includes('Execution context was destroyed')
  report.strictLocatorViolation = String(error.message).includes('strict mode violation')
  if (error.name === 'AssertionError') report.assertion = { actualType: typeof error.actual, expectedType: typeof error.expected, ...(typeof error.actual === 'number' ? { actual: error.actual, expected: error.expected } : {}) }
  if (page) {
    report.headerStatuses = await page.locator('header [role=status]').allTextContents().catch(() => [])
    report.visibleStatuses = await page.getByRole('status').allTextContents().catch(() => [])
  }
  if (otherPage) report.otherHeaderStatuses = await otherPage.locator('header [role=status]').allTextContents().catch(() => [])
  if (otherPage) await otherPage.screenshot({ path: resolve(output, 'cloud-failure-other.png'), fullPage: true, mask: [otherPage.getByRole('region', { name: '协作链接管理' })] }).catch(() => {})
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
  if (reportOwned) await writeFile(resolve(output, 'cloud-browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
