import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1'},stdio:'ignore'})
let browser;const report={scope:'local fictitious 150-guest/30-room memory project only',geometry:[],mobile:[],desktop:[],focus:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const url=new URL(response.headers.get('location'),origin),projectId=url.pathname.split('/')[3],secret=new URLSearchParams(url.hash.slice(1)).get('key')
 const read=async()=>{const r=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',projectId,secret})})).json();if(!r.ok)throw Error('READ_FAILED');return r.value}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}})
 page.on('pageerror',e=>{report.error=e.message})
 await page.goto(url.href);await page.getByText('已同步到云端',{exact:true}).waitFor();await page.locator('.konvajs-content').waitFor()
 async function geometry(){return page.evaluate(()=>{
  const el=document.querySelector('.konvajs-content');let node=el,stage
  while(node&&!stage){let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){stage=f.memoizedProps?.stageRef?.current;if(stage){window.__fixtureViewport=f.memoizedProps.viewport;window.__fixtureChangeViewport=f.memoizedProps.onViewportChange;break;}f=f.return}node=node.parentElement}
  window.__fixtureStage=stage
  const texts=stage.find('Text'),table=texts.find(n=>n.text()==='亲友第1桌').getParent(),ms=texts.find(n=>n.text()==='主 舞 台').getParent(),wm=texts.find(n=>n.text()==='囍')
  return {width:stage.width(),height:stage.height(),table:table.position(),mainPosition:ms.position(),mainWidth:ms.findOne('Rect').width(),main:ms.getClientRect(),watermark:wm.getAbsolutePosition(),tableAbsolute:table.getAbsolutePosition()}
 })}
 await geometry()
 for (const scale of [.2,.8,1,2]) {
  await page.evaluate(scale=>window.__fixtureChangeViewport(current=>({...current,scale,x:37,y:-19})),scale)
  await page.waitForTimeout(40)
  const a=await geometry()
  await page.evaluate(()=>window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent().fire('click',{evt:{}},true))
  await page.getByRole('button',{name:'关闭桌子详情',exact:true}).waitFor();const b=await geometry()
  assert.equal(b.width,a.width);assert.deepEqual(b.main,a.main);assert.deepEqual(b.watermark,a.watermark);assert.deepEqual(b.table,a.table)
  await page.getByRole('button',{name:'关闭桌子详情',exact:true}).click();const c=await geometry();assert.deepEqual(c.main,a.main)
  report.geometry.push({scale:await page.locator('.planner-zoom span').innerText(),width:a.width,selectionStable:true,watermarkStable:true})
 }
 for(const width of [768,1024,1280,1440]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(60)
  const sizes=await page.evaluate(()=>({width:innerWidth,sidebar:document.querySelector('.planner-sidebar').getBoundingClientRect().width,navDirection:getComputedStyle(document.querySelector('.planner-navigation')).flexDirection,libraryWidth:document.querySelector('.planner-page>div.hidden').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(sizes.navDirection,'column');assert.equal(sizes.libraryWidth,208);assert.equal(sizes.overflow,false);report.desktop.push(sizes)
 }
 for(const width of [360,390,430]){
  await page.setViewportSize({width,height:844});await page.waitForTimeout(100)
  const sizes=await page.evaluate(()=>({width:innerWidth,header:document.querySelector('.planner-header').getBoundingClientRect().height,nav:document.querySelector('.planner-navigation').getBoundingClientRect().height,tools:document.querySelector('[aria-label="排座工具"]').getBoundingClientRect().height,canvas:document.querySelector('.konvajs-content').getBoundingClientRect().height,height:visualViewport.height,overflow:document.documentElement.scrollWidth>innerWidth}))
  assert.ok(sizes.header+sizes.nav<=112);assert.ok(sizes.canvas/sizes.height>=.55);assert.equal(sizes.overflow,false);report.mobile.push(sizes)
 }
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(60);const landscape=await page.evaluate(()=>({canvas:document.querySelector('.konvajs-content').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));assert.ok(landscape.canvas>0);assert.equal(landscape.overflow,false);report.landscape=landscape;await page.setViewportSize({width:390,height:844})
 await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('button',{name:'导出表格',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出固定版本',exact:true});await dialog.waitFor();await dialog.getByText('导出安排',{exact:true}).click();await dialog.getByRole('button',{name:'关闭',exact:true}).click()
 report.focus=await page.evaluate(()=>({visible:document.activeElement?.tagName !== 'BODY' && !!document.activeElement?.getClientRects().length,tag:document.activeElement?.tagName}))
 await page.setViewportSize({width:1600,height:1000});await page.waitForTimeout(60)
 await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){const value=original.apply(this,args);if(this.width===3600&&this.height===2400)window.__fixtureExportBitmap=value;return value}})
 const exportButton=page.getByRole('button',{name:'导出 PNG',exact:true})
 async function captureBitmap(){await exportButton.click();const panel=page.getByRole('dialog',{name:'导出固定版本',exact:true});await panel.getByRole('button',{name:'生成固定版本座位图',exact:true}).click();await panel.getByAltText('本次固定版本座位图',{exact:true}).waitFor();const bitmap=await page.evaluate(()=>window.__fixtureExportBitmap);assert.ok(bitmap?.startsWith('data:image/png;base64,'));await panel.getByRole('button',{name:'关闭',exact:true}).click();return bitmap}
 const closedBitmap=await captureBitmap();await geometry();await page.evaluate(()=>window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent().fire('click',{evt:{}},true));const selectedBitmap=await captureBitmap();assert.equal(selectedBitmap,closedBitmap);report.png={fixedStageBitmapUnchangedBySelection:true}
 await page.getByRole('button',{name:'关闭桌子详情',exact:true}).click()
 const current=await read(),core=current.current?.data??current.data??current;const mutation=await(await fetch(origin+'/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'execute',projectId,secret,command:{projectId,dataEpoch:current.current?.dataEpoch??current.dataEpoch,commandVersion:1,operationId:crypto.randomUUID(),type:'project.update',payload:{patch:{mainStagePos:{x:620,y:65}}},expectedRevisions:{config:core.config.revision}}})})).json();assert.equal(mutation.ok,true)
 const seeded=await read();await page.reload();await page.getByText('已同步到云端',{exact:true}).waitFor();await page.locator('.konvajs-content').waitFor();await geometry();await page.evaluate(()=>window.__fixtureChangeViewport(current=>({...current,scale:1,x:0,y:0})));await page.waitForTimeout(60)
 for(const width of [1600,1024,390,1600]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(60);const a=await geometry();assert.deepEqual(a.mainPosition,{x:620,y:65});assert.equal(a.mainWidth,260);await page.evaluate(()=>window.__fixtureStage.find('Text').find(n=>n.text()==='亲友第1桌').getParent().fire('click',{evt:{}},true));const b=await geometry();assert.deepEqual(b.mainPosition,a.mainPosition);assert.equal(b.mainWidth,a.mainWidth);await page.getByRole('button',{name:'关闭桌子详情',exact:true}).click()}
 const unchanged=await read();assert.deepEqual(unchanged,seeded)
 const unchangedCore=unchanged.current?.data??unchanged.data??unchanged;assert.deepEqual(unchangedCore.config.mainStagePos,{x:620,y:65});assert.equal(unchangedCore.config.revision,core.config.revision+1);report.savedStage={positionAndWidthPreservedAcrossResizeAndSelection:true,noImplicitConfigWrites:true}
 const a=await geometry(),canvas=await page.locator('.konvajs-content').boundingBox();await page.mouse.move(canvas.x+a.tableAbsolute.x,canvas.y+a.tableAbsolute.y);await page.mouse.down();await page.mouse.move(canvas.x+a.tableAbsolute.x+40,canvas.y+a.tableAbsolute.y+30,{steps:12});await page.mouse.up();await page.locator('.planner-sync[data-state="synced"]').waitFor();const dragged=await read(),draggedCore=dragged.current?.data??dragged.data??dragged;assert.deepEqual({x:draggedCore.tables.t0.x,y:draggedCore.tables.t0.y},{x:190,y:230});report.pointer={actualMouseDragPersisted:true}
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(60);await geometry();await page.evaluate(()=>window.__fixtureChangeViewport(current=>({...current,scale:1,x:0,y:0})));await page.waitForTimeout(60)
 const touchGeometry=await geometry(),touchCanvas=await page.locator('.konvajs-content').boundingBox(),cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});const tx=touchCanvas.x+touchGeometry.tableAbsolute.x,ty=touchCanvas.y+touchGeometry.tableAbsolute.y
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty,id:1}]});for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx+step*5,y:ty+step*5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.locator('.planner-sync[data-state="synced"]').waitFor();const touched=await read(),touchedCore=touched.current?.data??touched.data??touched;assert.deepEqual({x:touchedCore.tables.t0.x,y:touchedCore.tables.t0.y},{x:220,y:260});report.pointer.syntheticChromiumTouchDragPersisted=true;await cdp.detach()
 assert.equal(report.error,undefined)
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});await writeFile(join(output,'planner-stage-b-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.equal(report.focus.visible,true)
} catch(e){console.error(e.stack);process.exitCode=1} finally {await browser?.close();fixture.kill('SIGTERM')}
