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

 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.locator('.konvajs-content').waitFor()
 async function geometry(){return page.evaluate(()=>{
  const el=document.querySelector('.konvajs-content');let node=el,stage
  while(node&&!stage){let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){stage=f.memoizedProps?.stageRef?.current;if(stage)break;f=f.return}node=node.parentElement}
  window.__fixtureStage=stage
  const texts=stage.find('Text'),table=texts.find(n=>n.text()==='亲友第1桌').getParent(),ms=texts.find(n=>n.text()==='主 舞 台').getParent(),wm=texts.find(n=>n.text()==='囍')
  return {width:stage.width(),table:table.position(),main:ms.position(),watermark:wm.getAbsolutePosition()}
 })}
 const before=await geometry()
 await page.evaluate(()=>{const table=window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent();table.position({x:450,y:500});const add=IDBObjectStore.prototype.add;window.__restoreAdd=()=>IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.add=function(...args){if(this.name==='outbox')throw new DOMException('fictitious write failure','QuotaExceededError');return add.apply(this,args)};table.fire('dragend',{evt:{}},true)})
 await page.locator('.planner-sync[data-state="local_error"]').waitFor();await page.waitForTimeout(150)
 const failed=await geometry();report.results.dragFailure={before:before.table,after:failed.table,rolledBack:JSON.stringify(before.table)===JSON.stringify(failed.table)}
 assert.deepEqual(failed.table,before.table)
 await page.evaluate(()=>{const ms=window.__fixtureStage.find('Text').find(n=>n.text()==='主 舞 台').getParent();ms.position({x:800,y:90});ms.fire('dragend',{evt:{}},true)})
 await page.getByText('舞台位置未能保存在本机，已回到当前保存位置。请检查顶部状态后重试。',{exact:true}).waitFor();const stageFailed=await geometry();assert.deepEqual(stageFailed.main,before.main);report.results.stageFailure={rolledBack:true}
 await page.evaluate(()=>{window.__restoreAdd();const t=window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent();t.position({x:400,y:410});t.fire('dragend',{evt:{}},true)})
 await page.locator('.planner-sync[data-state="synced"]').waitFor();assert.deepEqual((await geometry()).table,{x:400,y:410});report.results.retry={persisted:true}
 await page.context().setOffline(true);await page.evaluate(()=>{const t=window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent();t.position({x:500,y:510});t.fire('dragend',{evt:{}},true)})
 await page.locator('.planner-sync[data-state="unknown"]').waitFor();assert.deepEqual((await geometry()).table,{x:500,y:510});report.results.offline={localProjectionPreserved:true};await page.context().setOffline(false);await page.evaluate(()=>document.querySelector('.planner-header-status button')?.click());await page.locator('.planner-sync[data-state="synced"]').waitFor();const current=await read(),data=current.current?.data??current.data??current;assert.deepEqual({x:data.tables.t0.x,y:data.tables.t0.y},{x:500,y:510});report.results.offline.gatewayReadbackAfterResume=true
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'planner-canvas-failure-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
