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
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.getByRole('link',{name:'住宿安排',exact:true}).click();await page.getByLabel('房间排序',{exact:true}).selectOption('original');await page.getByRole('button',{name:'调整宾客和房间晚次',exact:true}).first().click()
 const dialog=page.getByRole('dialog',{name:'房间住宿安排'});await dialog.waitFor();await dialog.getByText('选人及房间晚次后，一次确认保存。',{exact:true}).waitFor();await dialog.getByRole('checkbox',{name:'2026-12-31',exact:true}).uncheck();await dialog.getByText('选择已保存在本机，尚未提交。',{exact:true}).waitFor()
 await page.context().setOffline(true);await dialog.getByRole('button',{name:'确认整批安排',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.locator('.planner-sync[data-state="unknown"]').waitFor();await page.context().setOffline(false);await page.evaluate(()=>document.querySelector('.planner-header-status button')?.click());await page.locator('.planner-sync[data-state="synced"]').waitFor()
 // Another collaborator empties the room after the original arrangement committed.
 for(const id of ['g0','g1']){const current=await read(),core=current.current?.data??current.data??current;const result=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'execute',projectId,secret,command:{projectId,dataEpoch:current.current?.dataEpoch??current.dataEpoch,commandVersion:1,operationId:crypto.randomUUID(),type:'guest.clearRoom',payload:{id},expectedRevisions:{[`guest:${id}`]:core.guests[id].revision}}})})).json();assert.equal(result.ok,true)}
 const before=await read();await page.reload();await page.getByText('已同步到云端',{exact:true}).waitFor();await page.getByRole('button',{name:'调整宾客和房间晚次',exact:true}).first().click();await dialog.waitFor();const recovery=dialog.locator('details').filter({hasText:'恢复房间安排草稿'});await recovery.locator('summary').click();await recovery.getByRole('button').first().click();await dialog.getByText('共安排 0 人。选择此房间使用的晚次，同房宾客共用这一安排。',{exact:true}).waitFor()
 const reconcile=dialog.getByRole('button',{name:'核对原提交',exact:true});assert.equal(await reconcile.isEnabled(),true,'receipt reconciliation must remain available after a room becomes empty');await reconcile.click();await dialog.waitFor({state:'hidden'})
 const after=await read();assert.deepEqual(after,before);const retained=await page.evaluate(async projectId=>{const {openFieldDraftVault}=await import('/src/fusion/fieldDrafts.ts');const vault=await openFieldDraftVault();try{return (await vault.list(projectId)).filter(d=>d.kind==='roomArrangement').length}finally{vault.close()}},projectId);assert.equal(retained,0)
 report.results={offlineFrozenFormReopened:true,emptyRoomStillAllowsReceiptQuery:true,committedRequestReconciledWithoutOverwrite:true,privateFormRemovedAfterConfirmedReceipt:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'room-recovery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
