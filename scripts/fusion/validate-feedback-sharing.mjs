import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1',FEEDBACK_EDITOR_FIXTURE:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/30-room memory project only',sharing:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin)
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.context().grantPermissions(['clipboard-read','clipboard-write'])
 await page.goto(origin+'/fusion');await page.getByRole('textbox',{name:'新项目名称',exact:true}).fill('虚构分享回归项目');await page.getByRole('button',{name:'新建独立项目',exact:true}).click();await page.getByText('项目已创建。请分别保管协作链接和管理链接。',{exact:true}).waitFor()
 await page.getByRole('button',{name:'复制协作链接',exact:true}).click();await page.getByText('已在复制前核对有效协作链接，可分享给家人。',{exact:true}).waitFor();const original=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(new URL(original).hash.includes('key='))
 const entry=await page.evaluate(async()=>{const {openCreationVault}=await import('/src/fusion/creationVault.ts');const vault=await openCreationVault();try{return (await vault.list())[0]}finally{vault.close()}})
 await page.getByRole('button',{name:'打开项目',exact:true}).click();await page.getByText('已同步到云端',{exact:true}).waitFor();await page.getByRole('button',{name:'协作链接',exact:true}).click();const dialog=page.getByRole('dialog',{name:'协作链接管理',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'准备新协作链接',exact:true}).click();await dialog.getByRole('button',{name:'确认更换并复制链接',exact:true}).click();await dialog.getByText('已重新核对并复制有效协作链接。',{exact:true}).waitFor();const rotated=await page.evaluate(()=>navigator.clipboard.readText());assert.notEqual(rotated,original)
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.goto(origin+'/fusion');await page.getByRole('button',{name:'复制协作链接',exact:true}).click();await page.getByText('已在复制前核对有效协作链接，可分享给家人。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),rotated);report.sharing={creationLinkVerified:true,rotationUsesCurrentLink:true}
 const other=await browser.newPage({permissions:['clipboard-read','clipboard-write']});await other.goto(origin+'/fusion');await other.evaluate(async entry=>{const {openCreationVault}=await import('/src/fusion/creationVault.ts');const vault=await openCreationVault();try{await vault.save(entry.request);await vault.confirm(entry.request.requestId)}finally{vault.close()}},entry);await other.reload();await other.evaluate(()=>navigator.clipboard.writeText('fictitious-sentinel'));await other.getByRole('button',{name:'复制协作链接',exact:true}).click();await other.getByText('当前协作链接已更换，此设备没有有效的新链接。请打开项目，在“协作链接”中核对本机记录，或明确准备并更换新链接。',{exact:true}).waitFor();assert.equal(await other.evaluate(()=>navigator.clipboard.readText()),'fictitious-sentinel');report.sharing.otherDeviceRefusesStaleLink=true
 await page.evaluate(()=>navigator.clipboard.writeText('fictitious-offline-sentinel'));await page.context().setOffline(true);await page.getByRole('button',{name:'复制协作链接',exact:true}).click();await page.getByText('未能核对或复制有效链接。请检查网络、项目权限和剪贴板权限；不会回退复制旧链接。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'fictitious-offline-sentinel');await page.context().setOffline(false);report.sharing.offlineDoesNotCopy=true
 const recipient=await browser.newPage();await recipient.goto(rotated);await recipient.getByText('已同步到云端',{exact:true}).waitFor();assert.equal(await recipient.getByRole('button',{name:'协作链接',exact:true}).count(),0);report.sharing.recipientCanOpenCollaboration=true
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'sharing-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
