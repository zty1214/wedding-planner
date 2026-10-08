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
 const dialog=page.getByRole('dialog',{name:'房间住宿安排'});await dialog.waitFor();await dialog.getByRole('searchbox',{name:'搜索住宿宾客'}).fill('虚构长姓名欧阳司徒一家亲友代表61')
 const row=dialog.locator('label').filter({hasText:'虚构长姓名欧阳司徒一家亲友代表61'});await row.getByRole('checkbox').check();await dialog.getByRole('checkbox',{name:'2026-12-31',exact:true}).check();await dialog.getByText('选择已保存在本机，尚未提交。',{exact:true}).waitFor()
 const current=await read(),core=current.current?.data??current.data??current
 const expected={config:core.config.revision};for(const guest of Object.values(core.guests))if(guest.stayDates.includes('2026-12-31'))expected[`guest:${guest.id}`]=guest.revision
 const mutation=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'execute',projectId,secret,command:{projectId,dataEpoch:current.current?.dataEpoch??current.dataEpoch,commandVersion:1,operationId:crypto.randomUUID(),type:'stayDate.remove',payload:{date:'2026-12-31'},expectedRevisions:expected}})})).json();assert.equal(mutation.ok,true)
 await dialog.getByRole('button',{name:'确认整批安排',exact:true}).click();await dialog.getByText('整批安排尚未确认，原选择和原请求仍保留。请先处理顶部提示与本机命令草稿，再核对或重新编辑。',{exact:true}).waitFor()
 const after=await read(),actual=after.current?.data??after.data??after
 const room=Object.values(actual.rooms).find(room=>room.label==='01');assert.equal(actual.guests.g60.roomId,null);assert.equal(room.stayDates,undefined);assert.equal(await row.getByRole('checkbox').isChecked(),true);assert.equal(await dialog.getByRole('checkbox',{name:'2026-12-31',exact:true}).isChecked(),true)
 const drafts=await page.evaluate(async projectId=>{const {openFieldDraftVault}=await import('/src/fusion/fieldDrafts.ts');const vault=await openFieldDraftVault();try{return (await vault.list(projectId)).filter(d=>d.kind==='roomArrangement').map(d=>({frozen:!!d.handoff,value:JSON.parse(d.value)}))}finally{vault.close()}},projectId)
 assert.equal(drafts.length,1);assert.equal(drafts[0].frozen,true);assert.deepEqual(drafts[0].value.guestIds,['g60']);assert.deepEqual(drafts[0].value.dates,['2026-12-31']);await dialog.getByText('（已从项目日期移除）',{exact:true}).waitFor();report.results={removedProjectDateRejectsWholeBatch:true,removedDateStillVisibleAndSelected:true,formSelectionsRetained:true,privateFrozenDraftRetained:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'room-date-conflict-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
