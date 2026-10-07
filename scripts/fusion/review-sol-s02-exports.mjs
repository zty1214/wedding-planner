// Browser delivery check using the actual export panel and a fixed synthetic snapshot.
import { createServer } from 'vite'
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>固定版本导出验收</title><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import ExportPanel from '/src/fusion/ExportPanel.tsx';
import {projectRepository} from '/src/fusion/repository.ts';
import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {emptyCore} from '/src/fusion/core.ts';import '/src/index.css';
const core=emptyCore();core.config.title='S02纯虚构150人导出';core.config.stayDates=['2026-12-31','2027-01-01'];
for(let t=0;t<15;t++){const id='t'+t;core.tables[id]={id,revision:0,label:'亲友桌 '+(t+1),seats:10,x:180+(t%5)*240,y:220+Math.floor(t/5)*250,rotation:0};core.tableOrder.push(id)}
for(let r=0;r<75;r++){const id='r'+r;core.rooms[id]={id,revision:0,label:String(r+1).padStart(3,'0'),type:'标间',notes:'纯虚构跨年安排'};core.roomOrder.push(id)}
for(let i=0;i<150;i++){const id='g'+i;core.guestOrder.push(id);core.guests[id]={id,revision:0,name:i===0?'欧阳司徒慕容长姓名验收 001':i===1?'欧阳司徒慕容长姓名验收 002':'虚构宾客 '+String(i+1).padStart(3,'0'),group:'朋友',phone:'00'+String(123456700+i),notes:'纯虚构',side:i%2?'bride':'groom',attendance:'confirmed',tableId:'t'+Math.floor(i/10),seatIndex:i%10,roomId:'r'+Math.floor(i/2),stayNeed:'needed',stayDates:i%3===0?['2026-12-31']:i%3===1?['2027-01-01']:['2026-12-31','2027-01-01']}}
const snapshot={role:'management',dataEpoch:'sol-s02-export-e',snapshotRevision:207,data:core,notes:[],notesRevision:0};
const storage=await openIndexedDbOutbox();
const projectId='sol-s02-local-150';
const repo=projectRepository(projectId,storage,{read:async()=>structuredClone(snapshot),execute:async()=>{throw Error('READ_ONLY_FIXTURE')},queryReceipt:async()=>null},(_key,body)=>body());await repo.open();
createRoot(document.getElementById('root')).render(React.createElement('main',{className:'p-4'},React.createElement('h1',null,'纯虚构导出验收：150 人、15 桌、75 房、跨年两晚；使用实际导出组件'),React.createElement(ExportPanel,{repo,initialKind:'guests',onClose:()=>{}}),null));
</script></html>`
const server=await createServer({cacheDir:'/private/tmp/planner-sol-s02-export-vite',server:{host:'127.0.0.1',port:4191,strictPort:true},plugins:[{name:'export-review',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!['/__sol_s02_exports'].includes(req.url))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]})
await server.listen();console.log('Export review: http://127.0.0.1:4191/__sol_s02_exports')
