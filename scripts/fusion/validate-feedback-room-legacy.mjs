import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1',FEEDBACK_DUPLICATE_ROOMS:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/30-room memory project only',results:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin),projectId=url.pathname.split('/')[3],secret=new URLSearchParams(url.hash.slice(1)).get('key')
 const read=async()=>{const r=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',projectId,secret})})).json();if(!r.ok)throw Error('READ_FAILED');return r.value}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.getByRole('link',{name:'住宿安排',exact:true}).click();await page.getByText('已有重名房间：001。请核对后修改房号，系统不会自动改名。',{exact:true}).waitFor();await page.getByText('标识：r0',{exact:true}).waitFor();await page.getByText('标识：r1',{exact:true}).waitFor()
 const before=await read(),core=before.current?.data??before.data??before;assert.equal(core.rooms.r0.label,'001');assert.equal(core.rooms.r1.label,'001');const associations=Object.fromEntries(Object.entries(core.guests).map(([id,g])=>[id,g.roomId]))
 const input=page.getByLabel('房号',{exact:true}).nth(1);assert.equal(await input.inputValue(),'001');await input.fill('父母房');const save=input.locator('..').locator('..').getByRole('button',{name:'保存房号',exact:true});await save.click();await save.waitFor({state:'hidden'});await page.locator('.planner-sync[data-state="synced"]').waitFor();assert.equal(await page.getByText('已有重名房间：001。请核对后修改房号，系统不会自动改名。',{exact:true}).count(),0)
 const renamed=await read(),renamedCore=renamed.current?.data??renamed.data??renamed;assert.equal(renamedCore.rooms.r0.label,'001');assert.equal(renamedCore.rooms.r1.label,'父母房');assert.deepEqual(Object.fromEntries(Object.entries(renamedCore.guests).map(([id,g])=>[id,g.roomId])),associations)
 const index=await page.getByLabel('房号',{exact:true}).evaluateAll(inputs=>inputs.findIndex(input=>input.value==='父母房'));assert.ok(index>=0);const card=page.getByLabel('房号',{exact:true}).nth(index).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');page.on('dialog',dialog=>dialog.accept());await card.getByTitle('删除房间',{exact:true}).click();await page.locator('.planner-sync[data-state="synced"]').waitFor();const deleted=await read(),deletedCore=deleted.current?.data??deleted.data??deleted;assert.equal(deletedCore.rooms.r1,undefined);assert.equal(deletedCore.guests.g2.roomId,null);assert.equal(deletedCore.guests.g3.roomId,null)
 await page.getByRole('combobox',{name:'添加房间',exact:true}).selectOption('大床房');const dialog=page.getByRole('dialog',{name:'房间住宿安排'});await dialog.waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.planner-sync[data-state="synced"]').waitFor();const rebuilt=await read(),rebuiltCore=rebuilt.current?.data??rebuilt.data??rebuilt;assert.equal(Object.keys(rebuiltCore.rooms).length,30);assert.equal(rebuiltCore.rooms.r0.label,'001');assert.equal(Object.values(rebuiltCore.rooms).filter(room=>room.label==='01').length,1);assert.ok(!Object.hasOwn(rebuiltCore.rooms,'r1'));assert.equal(rebuiltCore.guests.g2.roomId,null);assert.equal(rebuiltCore.guests.g3.roomId,null)
 report.results={legacyDuplicateVisibleWithDistinctIds:true,noAutomaticRenaming:true,explicitRenamePreservesGuestAssociations:true,deleteClearsOnlyThatRoomAssignments:true,recreationUsesNewIdentityAndAvailableNumber:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'room-legacy-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
