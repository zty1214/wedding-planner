// Real deployed dev UI. Only creates a new fictitious project; no source writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const localFixture = process.argv.includes('--local-fixture')
const origin = localFixture ? process.env.RELEASE_ACCEPTANCE_ORIGIN : 'https://dev-d1gh3jw1gdf06af22-1456231968.tcloudbaseapp.com'
if (!origin || (localFixture && !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin))) throw Error('LOCAL_FIXTURE_ORIGIN_REQUIRED')
const output = process.argv[2]
if (!output) throw Error('FRESH_OUTPUT_REQUIRED')
await mkdir(output, { mode: 0o700 })
const report = { scope: localFixture ? 'local fictitious gateway; deployed acceptance entry rehearsal only' : 'deployed browser UI and real business gateway; fictitious new project only', status: 'RUNNING', checks: [], supabaseRequests: 0 }
let stage = 'browser-start', browser, page
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  context.on('request', r => { if (new URL(r.url()).hostname.endsWith('supabase.co')) report.supabaseRequests++ })
  page = await context.newPage()
  const step = async (name, body) => { stage = name; await body(); report.checks.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  const button = name => page.getByRole('button', { name, exact: true })
  const synced = () => page.getByText('已同步到云端', { exact: true }).waitFor()
  const nav = name => page.getByRole('link', { name, exact: true }).click()
  let collaboration
  await step('root-fusion-project-entry', async () => {
    await page.goto(localFixture ? origin + '/fusion' : origin)
    await page.getByRole('heading', { name: '我的备婚项目', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/fusion')
  })
  await step('real-gateway-project-creation', async () => {
    await page.getByLabel('新项目名称').fill('部署验收虚构婚礼')
    await button('新建独立项目').click()
    await button('复制协作链接').waitFor(); await button('复制协作链接').click()
    await page.getByText('已在复制前核对有效协作链接，可分享给家人。', { exact: true }).waitFor()
    collaboration = await page.evaluate(() => navigator.clipboard.readText())
    assert.ok(collaboration.startsWith(origin + '/fusion/p/fusion-created-'))
    await button('打开项目').click()
    await page.getByRole('link', { name: '宾客名单', exact: true }).waitFor()
  })
  await step('guest-leading-zero-and-refresh-deep-link', async () => {
    await nav('宾客名单'); stage = 'guest-input'; await page.getByLabel('宾客姓名', { exact: true }).fill('部署验收虚构宾客')
    await page.getByLabel('宾客电话', { exact: true }).fill('00123456789'); stage = 'guest-add'; await button('添加').click()
    stage = 'guest-visible-before-refresh'; await page.getByText('00123456789', { exact: true }).waitFor()
    await synced(); stage = 'guest-visible-after-refresh'; await page.reload(); await page.getByText('00123456789', { exact: true }).waitFor()
    await page.screenshot({ path: output + '/guests.png', fullPage: true })
  })
  await step('seating-and-stay-real-pages', async () => {
    await nav('座位安排'); await page.getByRole('button', { name: /10人.*点击添加到画布/ }).click()
    await page.getByText('桌数：1 桌', { exact: true }).waitFor()
    assert.ok(await page.locator('.konvajs-content canvas').first().isVisible())
    await synced(); await nav('住宿安排'); await button('添加标间').click()
    const arrangement = page.getByRole('dialog', { name: '房间住宿安排', exact: true })
    await arrangement.waitFor(); await arrangement.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByLabel('房号', { exact: true }).fill('001'); await button('保存房号').click()
    await button('保存房号').waitFor({ state: 'hidden' }); await synced(); await page.reload(); await page.getByLabel('房号', { exact: true }).waitFor(); assert.equal(await page.getByLabel('房号', { exact: true }).inputValue(), '001')
  })
  await step('notes-published-and-refresh', async () => {
    await nav('备婚笔记'); await button('酒店').click(); await button('写笔记').click()
    await page.getByLabel('笔记标题').fill('部署验收虚构笔记'); await page.getByLabel('笔记正文').fill('仅用于独立业务部署验证。')
    stage = 'notes-publish'; await button('发布').click();
    stage = 'notes-editor-handoff-complete'; await page.getByRole('region', { name: '笔记草稿编辑器' }).waitFor({ state: 'hidden' });
    stage = 'notes-visible-before-refresh'; await page.getByText('仅用于独立业务部署验证。', { exact: true }).waitFor()
    stage = 'notes-cloud-confirmed'; await synced(); stage = 'notes-visible-after-refresh'; await page.reload(); await button('酒店').click(); await page.getByText('仅用于独立业务部署验证。', { exact: true }).waitFor()
  })
  await step('independent-mobile-context-reads-cloud-data', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const second = await mobile.newPage()
    await second.goto(collaboration.replace('/seating', '/guests'))
    await second.getByText('00123456789', { exact: true }).waitFor()
    const overflow = await second.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    await second.screenshot({ path: output + '/mobile-guests.png', fullPage: true })
    await mobile.close()
  })
  assert.equal(report.supabaseRequests, 0)
  report.status = 'PASS'
} catch {
  report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1
  if (page) {
    await page.screenshot({ path: output + '/failure.png', fullPage: true, mask: [page.locator('input'), page.getByRole('region', { name: '协作链接管理' })] }).catch(() => {})
    report.visibleHeadings = await page.getByRole('heading').allTextContents().catch(() => [])
    report.visibleAlerts = await page.getByRole('alert').allTextContents().catch(() => [])
  }
} finally {
  await browser?.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(report))
}
