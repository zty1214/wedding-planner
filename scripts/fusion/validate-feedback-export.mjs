import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),XLSX=require('xlsx'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1',FEEDBACK_EXPORT_FIXTURE:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/31-room memory project only',results:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin)
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor()
 await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('button',{name:'导出表格',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'导出固定版本',exact:true});await dialog.waitFor();await dialog.getByRole('combobox',{name:'导出类型',exact:true}).selectOption('rooms')
 await dialog.getByText('待确认住宿：已分房晚次待定 1 人，需要住宿未分房 1 人。待确认项另列明细，不计入酒店每晚用房。',{exact:true}).waitFor()
 const downloadBook=async()=>{const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载此固定版本',exact:true}).click();const download=await pending;assert.match(download.suggestedFilename(),/云端已确认_r0_/);assert.equal(await download.failure(),null);return XLSX.readFile(await download.path())}
 const rooms=await downloadBook();assert.deepEqual(rooms.SheetNames,['住宿明细','每晚用房','待确认住宿'])
 const nights=XLSX.utils.sheet_to_json(rooms.Sheets['每晚用房']);assert.deepEqual(nights.map(row=>row['合计用房']),[30,30]);assert.deepEqual(nights.map(row=>row['当晚安排人数']),[60,60])
 const pending=XLSX.utils.sheet_to_json(rooms.Sheets['待确认住宿']);assert.equal(pending.length,2);assert.equal(pending.find(row=>row['姓名']==='虚构宾客62')['待确认事项'],'已分房·晚次待定');assert.equal(pending.find(row=>row['姓名']==='虚构长姓名欧阳司徒一家亲友代表61')['待确认事项'],'需要住宿·未分房')
 const detail=XLSX.utils.sheet_to_json(rooms.Sheets['住宿明细']);assert.equal(detail[0]['房间号'],'01');assert.equal(detail[0]['备注'],'虚构待定安排');assert.equal(detail[0]['2026-12-31'],'');assert.equal(detail[1]['房间号'],'001');assert.ok(detail[1]['2026-12-31'].includes('虚构宾客2'))
 await dialog.getByRole('combobox',{name:'导出类型',exact:true}).selectOption('guests');const guests=await downloadBook();const rows=XLSX.utils.sheet_to_json(guests.Sheets[guests.SheetNames[0]],{defval:''}),guest=rows.find(row=>row['姓名']==='虚构宾客63');assert.ok(guest);assert.equal(guest['分组标签'],'新娘同事');assert.equal(guest['所属方'],'');assert.equal(guest['电话'],'00000000062')
 assert.match(rooms.Props.Subject,/云端已确认/);assert.match(rooms.Props.Subject,/核心版本 0/)
 report.results={actualBrowserDownloadsReadBack:true,nightlyRoomCountsExcludePending:true,roomNightsEstimateAllRoomMembers:true,pendingStatusesSeparated:true,leadingZeroLabelsAndNotesPreserved:true,fullGuestGroupAndUnsetSidePreserved:true,phoneLeadingZerosPreserved:true,confirmedVersionProvenance:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'export-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
