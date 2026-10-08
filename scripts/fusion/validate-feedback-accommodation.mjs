import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/30-room memory project only',results:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin),projectId=url.pathname.split('/')[3],secret=new URLSearchParams(url.hash.slice(1)).get('key')
 const read=async()=>{const r=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',projectId,secret})})).json();if(!r.ok)throw Error('READ_FAILED');return r.value}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.getByRole('link',{name:'住宿安排',exact:true}).click()
 await page.getByRole('combobox',{name:'添加房间',exact:true}).selectOption('大床房')
 const dialog=page.getByRole('dialog',{name:'房间住宿安排'});await dialog.waitFor()
 const search=dialog.getByRole('searchbox',{name:'搜索住宿宾客'});await search.waitFor();await search.fill('虚构长姓名欧阳司徒一家亲友代表61')
 const row=dialog.locator('label').filter({hasText:'虚构长姓名欧阳司徒一家亲友代表61'});await row.getByRole('checkbox').check()
 await dialog.getByRole('checkbox',{name:'2026-12-31',exact:true}).check();await dialog.getByRole('button',{name:'确认整批安排',exact:true}).click()
 await dialog.waitFor({state:'hidden'});await page.getByText('已同步到云端',{exact:true}).waitFor()
 const state=await read(),core=state.current?.data??state.data??state
 const newRoom=Object.values(core.rooms).find(r=>r.label==='01');assert.ok(newRoom);assert.equal(core.guests.g60.roomId,newRoom.id);assert.deepEqual(newRoom.stayDates,['2026-12-31'])
 report.results.createAssign={autoDialog:true,previouslyHiddenGuestFound:true,roomAndGuestReadback:true,unifiedDates:true}
 await page.getByRole('button',{name:'12.31',exact:true}).click()
 assert.ok(await page.getByLabel('房号',{exact:true}).count()>0)
 await page.getByRole('button',{name:'1.1',exact:true}).click()
 assert.equal(await page.getByLabel('房号',{exact:true}).evaluateAll(es=>es.some(e=>e.value==='01')),false)
 report.results.dateFilter={assignedNightVisible:true,otherNightHidden:true}
 await page.getByRole('button',{name:'全部',exact:true}).first().click()
 assert.equal(await page.getByLabel('房号',{exact:true}).first().inputValue(),'01');await page.getByLabel('房间排序',{exact:true}).selectOption('original')
 const roomInput=page.getByLabel('房号',{exact:true}).last();assert.equal(await roomInput.inputValue(),'01')
 const notes=page.getByLabel('房间备注',{exact:true}).last();await notes.fill('虚构备注：靠电梯');const saveNotes=page.getByRole('button',{name:'保存房间备注',exact:true}).last();await saveNotes.click();await saveNotes.waitFor({state:'hidden'})
 await page.getByText('已同步到云端',{exact:true}).waitFor();const reread=await read(),c=reread.current?.data??reread.data??reread;assert.equal(c.rooms[newRoom.id].notes,'虚构备注：靠电梯')
 await page.reload();await page.getByText('已同步到云端',{exact:true}).waitFor();assert.equal(await page.getByLabel('房间备注',{exact:true}).last().inputValue(),'虚构备注：靠电梯')
 assert.equal(await page.getByLabel('房间排序',{exact:true}).inputValue(),'original');report.results.sort={naturalNumberOrder:true,originalOrder:true,rememberedAfterReload:true}
 report.results.notes={editable:true,persistedAfterReload:true};assert.equal(report.error,undefined)
 report.results.mobile=await page.getByLabel('房号',{exact:true}).first().evaluate(e=>({firstRoomTop:e.getBoundingClientRect().top,visualHeight:visualViewport.height,overflow:document.documentElement.scrollWidth>innerWidth}));assert.ok(report.results.mobile.firstRoomTop<report.results.mobile.visualHeight);assert.equal(report.results.mobile.overflow,false)
 // An empty canceled room is retained, without assigning anyone or silently choosing dates.
 await page.getByRole('combobox',{name:'添加房间',exact:true}).selectOption('标间');await dialog.waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.locator('.planner-sync[data-state="synced"]').waitFor()
 const canceledState=await read(),canceledCore=canceledState.current?.data??canceledState.data??canceledState,canceled=Object.values(canceledCore.rooms).find(r=>r.label==='02');assert.ok(canceled);assert.equal(canceled.stayDates,undefined);assert.equal(Object.values(canceledCore.guests).some(g=>g.roomId===canceled.id),false);report.results.cancel={emptyRoomRetained:true,noGuestOrDateAssigned:true}
 // Network loss must still permit durable creation and one atomic arrangement.
 await page.context().setOffline(true);await page.getByRole('combobox',{name:'添加房间',exact:true}).selectOption('大床房');await dialog.waitFor();await page.locator('.planner-sync[data-state="unknown"]').waitFor()
 await search.fill('虚构宾客62');await dialog.locator('label').filter({hasText:'虚构宾客62'}).getByRole('checkbox').check();await dialog.getByRole('checkbox',{name:'2027-01-01',exact:true}).check();await dialog.getByText('选择已保存在本机，尚未提交。',{exact:true}).waitFor()
 await dialog.getByRole('button',{name:'确认整批安排',exact:true}).evaluate(button=>{button.click();button.click()});await dialog.waitFor({state:'hidden'});assert.equal(await page.getByLabel('房号',{exact:true}).evaluateAll(es=>es.filter(e=>e.value==='03').length),1)
 const offlineState=await read(),offlineCore=offlineState.current?.data??offlineState.data??offlineState;assert.equal(Object.values(offlineCore.rooms).some(r=>r.label==='03'),false);assert.equal(offlineCore.guests.g61.roomId,null)
 await page.context().setOffline(false);await page.evaluate(()=>document.querySelector('.planner-header-status button')?.click());await page.locator('.planner-sync[data-state="synced"]').waitFor()
 const resumedState=await read(),resumedCore=resumedState.current?.data??resumedState.data??resumedState,resumed=Object.values(resumedCore.rooms).filter(r=>r.label==='03');assert.equal(resumed.length,1);assert.deepEqual(resumed[0].stayDates,['2027-01-01']);assert.equal(resumedCore.guests.g61.roomId,resumed[0].id);assert.equal(resumedCore.guests.g61.attendance,offlineCore.guests.g61.attendance);report.results.offline={autoDialogAfterLocalCreation:true,localArrangementVisible:true,remoteUnchangedWhileOffline:true,oneRoomAfterDoubleConfirm:true,unifiedDatesAfterResume:true,attendancePreserved:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'planner-iteration-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
