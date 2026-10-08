import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1',FEEDBACK_EDITOR_FIXTURE:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/30-room memory project only',editing:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin)
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.locator('.konvajs-content').waitFor()
 await page.getByRole('link',{name:'宾客名单',exact:true}).click()
 const edit=page.getByTitle('编辑',{exact:true}).last();await edit.click()
 const input=page.getByRole('textbox',{name:'宾客姓名',exact:true});await input.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='宾客姓名')
 const position=await input.boundingBox();assert.ok(position.y>=0 && position.y<1000)
 await page.getByRole('button',{name:'保留草稿并关闭编辑',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('title')==='编辑');report.editing={desktopBottomGuestFocused:true,desktopReturnToRecord:true}
 const mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>report.error=e.message);await mobile.goto(url.href);await mobile.getByText('已同步到云端',{exact:true}).waitFor();await mobile.getByRole('link',{name:'宾客名单',exact:true}).click()
 const search=mobile.getByPlaceholder('搜索姓名或手机号');assert.ok((await search.boundingBox()).y<844)
 await mobile.getByRole('button',{name:'添加宾客',exact:true}).click();const guestDialog=mobile.getByRole('dialog',{name:'添加宾客',exact:true});await guestDialog.waitFor();const name=guestDialog.getByRole('textbox',{name:'宾客姓名',exact:true});await name.fill('虚构手机草稿');await guestDialog.getByText('宾客草稿已保存在本机，尚未添加到共享名单。',{exact:true}).waitFor();await guestDialog.getByRole('button',{name:'保留草稿并关闭编辑',exact:true}).click();await guestDialog.waitFor({state:'hidden'});report.editing.mobileNewGuestModal=true
 await mobile.getByTitle('编辑',{exact:true}).last().click();const guestEdit=mobile.getByRole('dialog',{name:'编辑宾客',exact:true});await guestEdit.waitFor();await mobile.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='宾客姓名');await guestEdit.getByRole('button',{name:'保留草稿并关闭编辑',exact:true}).click();await mobile.waitForFunction(()=>document.activeElement?.getAttribute('title')==='编辑');report.editing.mobileBottomGuestModalAndReturn=true
 await mobile.getByRole('link',{name:'备婚笔记',exact:true}).click();await mobile.getByRole('button',{name:'备忘',exact:true}).click();await mobile.getByText('虚构编辑笔记25',{exact:true}).waitFor();report.editing.extraNoteCategoryVisible=true
 await mobile.getByRole('button',{name:'酒店',exact:true}).click();await mobile.getByRole('button',{name:'编辑',exact:true}).last().click();const noteDialog=mobile.getByRole('dialog',{name:'编辑笔记',exact:true});await noteDialog.waitFor();await mobile.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='笔记标题');await noteDialog.getByRole('button',{name:'关闭并保留草稿',exact:true}).click();await noteDialog.waitFor({state:'hidden'});await mobile.waitForFunction(()=>document.activeElement?.textContent==='编辑');report.editing.mobileBottomNoteModalAndReturn=true
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'editor-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
