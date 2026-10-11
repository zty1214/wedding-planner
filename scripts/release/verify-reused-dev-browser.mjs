// Real deployed dev UI. Only creates a new fictitious project; no source writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
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
    await page.getByLabel('新项目名称').fill('逐人晚次验收虚构婚礼')
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
    await page.getByLabel('宾客姓名', { exact: true }).fill('部署验收虚构宾客乙'); await button('添加').click(); await page.getByText('部署验收虚构宾客乙', { exact: true }).waitFor(); await synced();
    await page.screenshot({ path: output + '/guests.png', fullPage: true })
  })
  await step('seating-and-stay-real-pages', async () => {
    await nav('座位安排'); await page.getByRole('button', { name: /10人.*点击添加到画布/ }).click()
    await page.getByText('桌数：1 桌', { exact: true }).waitFor()
    assert.ok(await page.locator('.konvajs-content canvas').first().isVisible())
    await synced(); await nav('住宿安排')
    await button('添加日期').click()
    const heading = page.getByText(/^[0-9]{4} 年 [0-9]+ 月$/)
    for (let i = 0; i < 48; i++) {
      const match = (await heading.textContent()).match(/([0-9]+) 年 ([0-9]+) 月/)
      const delta = 2026 * 12 + 12 - (Number(match[1]) * 12 + Number(match[2]))
      if (!delta) break
      await heading.locator('..').getByRole('button').nth(delta > 0 ? 1 : 0).click()
    }
    assert.equal(await heading.textContent(), '2026 年 12 月')
    await heading.locator('../..').getByRole('button', { name: '31', exact: true }).click()
    await synced(); await button('添加日期').click();
    for(let i=0;i<48;i++){const m=(await heading.textContent()).match(/([0-9]+) 年 ([0-9]+) 月/);const d=2027*12+1-(Number(m[1])*12+Number(m[2]));if(!d)break;await heading.locator('..').getByRole('button').nth(d>0?1:0).click()}
    await heading.locator('../..').getByRole('button',{name:'1',exact:true}).click();await synced(); await button('添加标间').click()
    const arrangement = page.getByRole('dialog', { name: '房间住宿安排', exact: true })
    await arrangement.waitFor()
    await arrangement.getByRole('searchbox', { name: '搜索住宿宾客', exact: true }).fill('部署验收虚构宾客')
    await arrangement.locator('.planner-room-guest-row').filter({has:page.getByText('部署验收虚构宾客',{exact:true})}).getByRole('checkbox').check()
    await arrangement.getByRole('checkbox', { name: '2026-12-31', exact: true }).check()
    await arrangement.getByRole('button', { name: '确认整批安排', exact: true }).click()
    await arrangement.waitFor({ state: 'hidden' }); await synced()
    assert.equal(await page.getByLabel('房号', { exact: true }).inputValue(), '标间1')
    const cardDate=page.getByRole('button',{name:'部署验收虚构宾客住宿2026-12-31',exact:true})
    assert.equal(await cardDate.getAttribute('aria-pressed'),'true')
    await button('添加宾客').click(); await arrangement.waitFor()
    await arrangement.getByRole('searchbox',{name:'搜索住宿宾客',exact:true}).fill('部署验收虚构宾客乙')
    await arrangement.locator('.planner-room-guest-row').filter({has:page.getByText('部署验收虚构宾客乙',{exact:true})}).getByRole('checkbox').check()
    await arrangement.getByRole('checkbox',{name:'2027-01-01',exact:true}).check()
    await arrangement.getByRole('button',{name:'确认整批安排',exact:true}).click();await arrangement.waitFor({state:'hidden'});await synced()
    assert.equal(await cardDate.getAttribute('aria-pressed'),'true')
    assert.equal(await page.getByRole('button',{name:'部署验收虚构宾客住宿2027-01-01',exact:true}).getAttribute('aria-pressed'),'false')
    assert.equal(await page.getByRole('button',{name:'部署验收虚构宾客乙住宿2027-01-01',exact:true}).getAttribute('aria-pressed'),'true')
    stage='individual-date-off';await cardDate.click();await page.getByRole('button',{name:'部署验收虚构宾客住宿2026-12-31',exact:true,pressed:false}).waitFor();await synced();assert.equal(await cardDate.getAttribute('aria-pressed'),'false')
    assert.equal(await page.getByRole('button',{name:'部署验收虚构宾客乙住宿2027-01-01',exact:true}).getAttribute('aria-pressed'),'true')
    stage='individual-date-on-and-refresh';await cardDate.click();await page.getByRole('button',{name:'部署验收虚构宾客住宿2026-12-31',exact:true,pressed:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('button[aria-label="部署验收虚构宾客住宿2026-12-31"]').disabled);await synced();await page.reload();await synced()
    assert.equal(await cardDate.getAttribute('aria-pressed'),'true')
    report.checks.push({name:'same-room-staggered-guest-dates-save-and-reload',status:'PASS'})
    assert.equal(await button('调整宾客和房间晚次').count(),0)
    const note=page.getByLabel('房间备注',{exact:true}),people=page.locator('.planner-stay ul').first()
    assert.ok((await note.boundingBox()).y>(await people.boundingBox()).y+(await people.boundingBox()).height)
    await note.fill('虚构房间备注：安静位置');await button('保存房间备注').click();await button('保存房间备注').waitFor({state:'hidden'});await synced();await page.reload();await synced();assert.equal(await note.inputValue(),'虚构房间备注：安静位置')
    report.checks.push({name:'visible-bottom-note-persists-and-redundant-action-removed',status:'PASS'})
    await page.getByLabel('房号', { exact: true }).fill('001'); await button('保存房号').click()
    await button('保存房号').waitFor({ state: 'hidden' }); await synced(); await page.reload(); await page.getByLabel('房号', { exact: true }).waitFor(); assert.equal(await page.getByLabel('房号', { exact: true }).inputValue(), '001')
    await button('12.31').click()
    assert.equal((await page.getByText('当晚房间数', { exact: true }).locator('..').innerText()).split('\n')[0], '1')
    assert.equal((await page.getByText('当晚安排人数', { exact: true }).locator('..').innerText()).split('\n')[0], '1')
    await page.getByText('部署验收虚构宾客', { exact: true }).waitFor();assert.equal(await page.getByText('部署验收虚构宾客乙',{exact:true}).count(),0)
    await button('1.1').click();assert.equal(await page.getByText('部署验收虚构宾客',{exact:true}).count(),0);await page.getByText('部署验收虚构宾客乙',{exact:true}).waitFor()
    assert.equal((await page.getByText('当晚房间数',{exact:true}).locator('..').innerText()).split('\n')[0],'1');assert.equal((await page.getByText('当晚安排人数',{exact:true}).locator('..').innerText()).split('\n')[0],'1')
    report.checks.push({name:'night-filter-shows-only-that-guests-one-room-one-person',status:'PASS'})
  })
  await step('notes-published-and-refresh', async () => {
    await nav('备婚笔记'); await button('酒店').click(); await button('写笔记').click()
    await page.getByLabel('笔记标题').fill('部署验收虚构笔记'); await page.getByLabel('笔记正文').fill('仅用于独立业务部署验证。')
    stage = 'notes-publish'; await button('发布').click();
    stage = 'notes-editor-handoff-complete'; await page.getByRole('region', { name: '笔记草稿编辑器' }).waitFor({ state: 'hidden' });
    stage = 'notes-visible-before-refresh'; await page.getByText('仅用于独立业务部署验证。', { exact: true }).waitFor()
    stage = 'notes-cloud-confirmed'; await synced(); stage = 'notes-visible-after-refresh'; await page.reload(); await button('酒店').click(); await page.getByText('仅用于独立业务部署验证。', { exact: true }).waitFor()
  })
  await step('confirmed-room-export-download-matches-nightly-statistics', async () => {
    await button('导出表格').click()
    const panel = page.getByRole('dialog', { name: '导出固定版本', exact: true })
    await panel.getByRole('combobox', { name: '导出类型', exact: true }).selectOption('rooms')
    const pending = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载此固定版本', exact: true }).click()
    const download = await pending
    assert.equal(await download.failure(), null)
    assert.match(download.suggestedFilename(), /云端已确认/)
    const workbook = XLSX.read(await readFile(await download.path()), { type: 'buffer' })
    const nights = XLSX.utils.sheet_to_json(workbook.Sheets['每晚用房'])
    assert.equal(nights.length,2);for(const n of nights){assert.equal(n['合计用房'],1);assert.equal(n['当晚安排人数'],1)}
    const detail = XLSX.utils.sheet_to_json(workbook.Sheets['住宿明细'])
    assert.equal(detail.length, 1); assert.equal(detail[0]['房间号'], '001')
    assert.equal(detail[0]['2026-12-31'],'部署验收虚构宾客');assert.equal(detail[0]['2027-01-01'],'部署验收虚构宾客乙');assert.equal(detail[0]['备注'],'虚构房间备注：安静位置')
    assert.match(workbook.Props.Subject, /云端已确认/)
    await panel.getByRole('button', { name: '关闭', exact: true }).click()
  })
  await step('independent-mobile-context-reads-cloud-data', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const second = await mobile.newPage()
    await second.goto(collaboration.replace('/seating', '/guests'))
    await second.getByText('00123456789', { exact: true }).waitFor()
    const overflow = await second.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    await second.screenshot({ path: output + '/mobile-guests.png', fullPage: true })
    await second.getByRole('link', { name: '住宿安排', exact: true }).click()
    await second.getByRole('button', { name: '12.31', exact: true }).click()
    assert.equal(await second.getByLabel('房号', { exact: true }).inputValue(), '001')
    await second.getByText('部署验收虚构宾客', { exact: true }).waitFor()
    assert.equal((await second.getByText('当晚房间数', { exact: true }).locator('..').innerText()).split('\n')[0], '1')
    assert.equal(await second.getByText('部署验收虚构宾客乙',{exact:true}).count(),0);await second.getByRole('button',{name:'1.1',exact:true}).click();await second.getByText('部署验收虚构宾客乙',{exact:true}).waitFor();assert.equal(await second.getByText('部署验收虚构宾客',{exact:true}).count(),0);assert.equal(await second.getByLabel('房间备注',{exact:true}).inputValue(),'虚构房间备注：安静位置');assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await second.screenshot({ path: output + '/mobile-stay.png', fullPage: true })
    await mobile.close()
  })
  assert.equal(report.supabaseRequests, 0)
  report.status = 'PASS'
} catch (error) {
  report.error=error.name+': '+error.message.split('\n')[0];
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
