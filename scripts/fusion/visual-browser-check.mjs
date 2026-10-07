// Read-only visual capture of an explicitly supplied localhost product preview.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const [entry, directory] = process.argv.slice(2)
if (!entry || !directory || !/^http:\/\/127\.0\.0\.1:\d+\//.test(entry)) throw Error('LOCAL_PREVIEW_REQUIRED')
await mkdir(directory, { recursive: false })
const report = { sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scope: 'desktop Chromium viewport simulation; no real-device claim', captures: [], keyboardDialogs: [], longData: [] }
const browser = await chromium.launch()
try {
  for (const width of [1280, 1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    await page.goto(entry)
    await page.getByRole('status').filter({ hasText: '已同步到云端' }).waitFor({ timeout: 45000 })
    for (const [key, label] of [['guests', '宾客名单'], ['seating', '座位安排'], ['stay', '住宿安排'], ['notes', '备婚笔记'], ['history', '历史版本'], ['recycle', '回收站']]) {
      let link = page.getByRole('link', { name: label, exact: true })
      if (!await link.isVisible() && await page.getByRole('button', { name: '更多操作', exact: true }).count()) await page.getByRole('button', { name: '更多操作', exact: true }).click()
      await link.click()
      await page.getByRole('status').filter({ hasText: '已同步到云端' }).waitFor()
      if (key === 'seating') await page.getByTitle('定位所有桌子', { exact: true }).click()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (process.env.VISUAL_SCALE_EXPECT === '1' && key === 'guests') {
        await page.getByLabel(/的出席状态$/).first().waitFor()
        assert.equal(await page.getByLabel(/的出席状态$/).count(), 150)
        const longName = page.getByText('虚构长姓名欧阳司徒一家亲友代表1', { exact: true })
        await longName.scrollIntoViewIfNeeded(); assert.equal(await longName.isVisible(), true)
        const last = page.getByText('虚构宾客150', { exact: true })
        await last.scrollIntoViewIfNeeded(); assert.equal(await last.isVisible(), true)
        await longName.scrollIntoViewIfNeeded()
        report.longData.push({ width, guestCount: 150, fullLongNameVisible: true, lastGuestReachable: true })
      }
      if (process.env.VISUAL_SCALE_EXPECT === '1' && key === 'notes') {
        const content = page.locator('p.whitespace-pre-wrap').filter({ hasText: '虚构备婚记录：' })
        await content.waitFor()
        assert.equal(await content.textContent(), '虚构备婚记录：确认场地、交通、宾客到达与房间安排。\n'.repeat(80))
        await content.scrollIntoViewIfNeeded()
        report.longData.push({ width, completeLongNote: true, paragraphs: 80 })
      }
      const geometry = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, height: innerHeight }))
      const filename = `${width}-${key}.png`
      await page.screenshot({ path: resolve(directory, filename), fullPage: true, mask: [page.getByRole('region', { name: '协作链接管理' })] })
      report.captures.push({ page: key, filename, ...geometry, horizontalOverflow: geometry.documentWidth > geometry.width })
    }
    for (const [action, label] of [['导出表格', '导出固定版本'], ['查看本机草稿', '本机草稿'], ['协作链接', '协作链接管理']]) {
      const opener = page.getByRole('button', { name: action, exact: true })
      if (!await opener.isVisible()) await page.getByRole('button', { name: '更多操作', exact: true }).click()
      await opener.click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await dialog.waitFor()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      report.currentStage = `${width}/${action}/focus-contained`
      for (let i = 0; i < 36; i++) {
        await page.keyboard.press(i < 18 ? 'Tab' : 'Shift+Tab')
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
      }
      const geometry = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }))
      const filename = `${width}-dialog-${action}.png`
      await page.screenshot({ path: resolve(directory, filename), fullPage: true, mask: [page.getByRole('region', { name: '协作链接管理' })] })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      report.currentStage = `${width}/${action}/focus-returned`
      assert.equal(await opener.evaluate(node => document.activeElement === node), true)
      report.keyboardDialogs.push({ width, action, filename, focusContained: true, escapeClosed: true, focusReturned: true, horizontalOverflow: geometry.documentWidth > width })
    }
    const projects = page.getByRole('link', { name: '我的项目', exact: true })
    if (!await projects.isVisible()) await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await projects.click()
    await page.getByLabel('新项目名称').waitFor()
    await page.screenshot({ path: resolve(directory, `${width}-projects.png`), fullPage: true })
    await context.close()
  }
  delete report.currentStage
  report.status = 'captured'
  if (process.env.VISUAL_EXPECT_NO_OVERFLOW === '1' && report.captures.some(c => c.horizontalOverflow)) throw Error('DOCUMENT_OVERFLOW')
} catch (error) { report.status = 'failed'; report.failure = error.name; report.failureCode = String(error.message).includes('Timeout') ? 'UI_TIMEOUT' : 'VISUAL_CAPTURE_FAILED'; process.exitCode = 1 }
finally { await browser.close(); await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ status: report.status, captures: report.captures.length, overflow: report.captures.filter(c => c.horizontalOverflow).map(c => [c.width, c.page]) }))
