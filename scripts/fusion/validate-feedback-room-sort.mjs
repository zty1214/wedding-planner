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
 const execute=async(type,payload,expectedRevisions)=>{const current=await read();const result=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'execute',projectId,secret,command:{projectId,dataEpoch:current.current?.dataEpoch??current.dataEpoch,commandVersion:1,operationId:crypto.randomUUID(),type,payload,expectedRevisions}})})).json();return result}
 for(const [id,label] of [['r0','10'],['r1','2'],['r2','1'],['r3','父母房'],['r4','001']]) assert.equal((await execute('room.update',{id,patch:{label}},{[`room:${id}`]:0})).ok,true)
 assert.equal((await execute('room.add',{id:'sort-big-bed',label:'新房',type:'大床房'},{})).ok,true)
 const before=await read(),core=before.current?.data??before.data??before,order=[...core.roomOrder],associations=Object.fromEntries(Object.entries(core.guests).map(([id,g])=>[id,g.roomId]))
 await page.reload();await page.getByText('已同步到云端',{exact:true}).waitFor();const sort=page.getByLabel('房间排序',{exact:true});assert.equal(await sort.inputValue(),'type');assert.equal(await page.getByLabel('房号',{exact:true}).first().inputValue(),'新房')
 await sort.selectOption('number');const values=await page.getByLabel('房号',{exact:true}).evaluateAll(inputs=>inputs.map(input=>input.value));assert.ok(values.indexOf('1')<values.indexOf('2'));assert.ok(values.indexOf('2')<values.indexOf('10'));assert.ok(values.includes('001'));assert.ok(values.includes('父母房'))
 const other=await browser.newPage({viewport:{width:390,height:844}});await other.goto(url.href);await other.getByText('已同步到云端',{exact:true}).waitFor();await other.getByRole('link',{name:'住宿安排',exact:true}).click();assert.equal(await other.getByLabel('房间排序',{exact:true}).inputValue(),'type');await other.getByLabel('房间排序',{exact:true}).selectOption('original');assert.equal(await other.getByLabel('房号',{exact:true}).first().inputValue(),'10')
 await page.reload();await page.getByText('已同步到云端',{exact:true}).waitFor();assert.equal(await sort.inputValue(),'number');await other.reload();await other.getByText('已同步到云端',{exact:true}).waitFor();assert.equal(await other.getByLabel('房间排序',{exact:true}).inputValue(),'original')
 const after=await read(),actual=after.current?.data??after.data??after;assert.deepEqual(actual.roomOrder,order);assert.deepEqual(Object.fromEntries(Object.entries(actual.guests).map(([id,g])=>[id,g.roomId])),associations);assert.equal(actual.rooms.r4.label,'001')
 assert.equal((await execute('room.update',{id:'r2',patch:{label:' 2 '}},{'room:r2':1})).ok,false);const rejected=await read(),unchanged=rejected.current?.data??rejected.data??rejected;assert.equal(unchanged.rooms.r2.label,'1');assert.equal(unchanged.rooms.r1.label,'2')
 report.results={mixedNumericNaturalOrder:true,leadingZeroAndChinesePreserved:true,defaultTypeGrouping:true,independentBrowserPreferences:true,preferencesSurviveReload:true,sortingDoesNotRewriteRoomOrderOrAssociations:true,duplicateRenameRejected:true}
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'room-sort-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
