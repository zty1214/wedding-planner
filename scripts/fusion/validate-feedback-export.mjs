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
 const nights=XLSX.utils.sheet_to_json(rooms.Sheets['每晚用房']);assert.deepEqual(nights.map(row=>row['合计用房']),[30,30]);assert.deepEqual(nights.map(row=>row['当晚安排人数']),[30,60])
 const pending=XLSX.utils.sheet_to_json(rooms.Sheets['待确认住宿']);assert.equal(pending.length,2);assert.equal(pending.find(row=>row['姓名']==='虚构宾客62')['待确认事项'],'已分房·晚次待定');assert.equal(pending.find(row=>row['姓名']==='虚构长姓名欧阳司徒一家亲友代表61')['待确认事项'],'需要住宿·未分房')
 const detail=XLSX.utils.sheet_to_json(rooms.Sheets['住宿明细']);assert.equal(detail[0]['房间号'],'01');assert.equal(detail[0]['备注'],'虚构待定安排');assert.equal(detail[0]['2026-12-31'],'');assert.equal(detail[1]['房间号'],'001');assert.ok(detail[1]['2026-12-31'].includes('虚构长姓名欧阳司徒一家亲友代表1'));assert.equal(detail[1]['2026-12-31'].includes('虚构宾客2'),false);assert.ok(detail[1]['2027-01-01'].includes('虚构宾客2'))
 await dialog.getByRole('combobox',{name:'导出类型',exact:true}).selectOption('guests');const guests=await downloadBook();const rows=XLSX.utils.sheet_to_json(guests.Sheets[guests.SheetNames[0]],{defval:''}),guest=rows.find(row=>row['姓名']==='虚构宾客63');assert.ok(guest);assert.equal(guest['分组标签'],'新娘同事');assert.equal(Object.hasOwn(guest,'所属方'),false);assert.equal(guest['住宿需求'],'不需要住宿');assert.equal(guest['宾客编号'],'g62');assert.equal(guest['电话'],'00000000062')
 assert.match(rooms.Props.Subject,/云端已确认/);assert.match(rooms.Props.Subject,/核心版本 0/)
 report.results={actualBrowserDownloadsReadBack:true,nightlyRoomCountsExcludePending:true,individualNightsCountOnlySelectedGuests:true,pendingStatusesSeparated:true,leadingZeroLabelsAndNotesPreserved:true,fullGuestGroupAndStayNeedPreserved:true,guestIdIncludedWithoutSide:true,phoneLeadingZerosPreserved:true,confirmedVersionProvenance:true}
 await dialog.getByRole('button',{name:'关闭',exact:true}).click()
 await page.getByRole('link',{name:'宾客名单',exact:true}).click()
 const read=async()=>{
   const u=new URL(url),projectId=u.pathname.split('/')[3],secret=new URLSearchParams(u.hash.slice(1)).get('key')
   const result=await (await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',projectId,secret})})).json()
   assert.equal(result.ok,true);return result.value
 }
 const before=await read()
 await page.getByRole('button',{name:'导入名单',exact:true}).click()
 const importer=page.getByRole('dialog',{name:'导入宾客名单',exact:true}),choose=importer.getByLabel('选择 Excel 名单',{exact:true})
 const upload=async(book)=>choose.setInputFiles({name:'fictional-guests.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})})
 await upload(guests);await importer.getByText('名单没有变化，无需导入。',{exact:true}).waitFor()
 assert.deepEqual(await read(),before)
 const editedRows=rows.filter(row=>row['宾客编号']!=='g62')
 editedRows[0]['姓名']='虚构改名仍保留安排';editedRows[0]['桌号/桌名']='导入不改桌号'
 editedRows.push({姓名:'虚构新导入宾客',电话:'00000123',分组标签:'导入新类别',出席状态:'待确认',住宿需求:'需要住宿','桌号/桌名':'',备注:'虚构备注',宾客编号:''})
 guests.Sheets['宾客名单']=XLSX.utils.json_to_sheet(editedRows,{header:['姓名','电话','分组标签','出席状态','住宿需求','桌号/桌名','备注','宾客编号']})
 await upload(guests)
 await importer.getByText('新增 1 人 · 更新 1 人 · 移除 1 人',{exact:true}).waitFor()
 assert.ok(await importer.getByText('虚构宾客63 · 新娘同事 · 已排座',{exact:true}).isVisible())
 const confirm=importer.getByRole('button',{name:'确认替换宾客名单',exact:true});assert.ok(await confirm.isDisabled())
 assert.deepEqual(await read(),before)
 await importer.getByRole('checkbox',{name:'我已核对将移除的宾客',exact:true}).check();await confirm.click()
 await importer.getByText(/名单已替换，保留宾客的座位和住宿安排未变/).waitFor()
 const after=await read();assert.notEqual(after.dataEpoch,before.dataEpoch);assert.equal(after.data.guests.g62,undefined)
 assert.equal(after.data.guests.g0.name,'虚构改名仍保留安排');assert.deepEqual([after.data.guests.g0.tableId,after.data.guests.g0.seatIndex,after.data.guests.g0.roomId,after.data.guests.g0.stayDates],[before.data.guests.g0.tableId,before.data.guests.g0.seatIndex,before.data.guests.g0.roomId,before.data.guests.g0.stayDates])
 const last=after.data.guests[after.data.guestOrder.at(-1)];assert.equal(last.name,'虚构新导入宾客');assert.equal(last.phone,'00000123');assert.equal(last.stayNeed,'needed');assert.equal(last.tableId,null)
 assert.deepEqual(after.data.tables,before.data.tables);assert.deepEqual(after.data.rooms,before.data.rooms);assert.deepEqual(after.notes,before.notes)
 await importer.getByRole('button',{name:'关闭',exact:true}).click()
 await page.getByRole('button',{name:'更多操作',exact:true}).click()
 await page.getByRole('link',{name:'历史版本',exact:true}).click();await page.getByRole('heading',{name:'替换宾客名单前的安全版本',exact:true}).waitFor()
 report.rosterImport={actualDownloadedWorkbookNoOpRoundTrip:true,previewDoesNotWrite:true,confirmationRequiredForRemoval:true,completeReplacementOnConfirm:true,seatAndStayPreserved:true,notesAndOtherEntitiesUnchanged:true,safetyVersionVisible:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'export-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
