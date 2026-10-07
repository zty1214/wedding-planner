// Browser delivery check using the actual export panel and a fixed synthetic snapshot.
import { createServer } from 'vite'
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>固定版本导出验收</title><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import ExportPanel from '/src/fusion/ExportPanel.tsx';
import PrivateDraftPanel from '/src/fusion/PrivateDraftPanel.tsx';
import {openFieldDraftVault} from '/src/fusion/fieldDrafts.ts';
import {projectRepository} from '/src/fusion/repository.ts';
import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {emptyCore} from '/src/fusion/core.ts';import '/src/index.css';
const core=emptyCore();core.config.title='纯虚构导出验收';core.config.stayDates=['2026-12-31','2027-01-01'];
core.tables.t={id:'t',revision:0,label:'亲友桌',seats:8,x:400,y:300,rotation:0};core.tableOrder=['t'];
core.rooms.r={id:'r',revision:0,label:'001',type:'标间',notes:'虚构跨年安排'};core.roomOrder=['r'];
for(let i=0;i<2;i++){const id='g'+i;core.guestOrder.push(id);core.guests[id]={id,revision:0,name:i?'小明 2':'小明',group:'朋友',phone:i?'0012345679':'0012345678',notes:'纯虚构',side:i?'bride':'groom',attendance:'confirmed',tableId:'t',seatIndex:i,roomId:'r',stayNeed:'needed',stayDates:i?['2027-01-01']:['2026-12-31','2027-01-01']}}
const snapshot={role:'management',dataEpoch:'export-e',snapshotRevision:7,data:core,notes:[],notesRevision:0};
const storage=await openIndexedDbOutbox();
const draftMode=location.pathname==='/__exports_draft_review';const projectId=draftMode?'browser-export-reopened-fixture':'browser-export-fixture';
if(draftMode){for(const [index,patch] of [{name:'重开后姓名 2'},{phone:'0098765432'}].entries())await storage.insert({status:'prepared',command:{projectId,dataEpoch:'export-e',operationId:'export-draft-'+index,commandVersion:1,type:'guest.update',payload:{id:'g1',patch},expectedRevisions:{'guest:g1':index}}})}
if(draftMode){const vault=await openFieldDraftVault();try{if(!(await vault.list(projectId)).some(d=>d.id==='orphan-table'))await vault.save({id:'orphan-table',projectId,dataEpoch:'old-export-e',entityId:'deleted-table',kind:'table',entityRevision:0,value:'已删除桌子的旧草稿',revision:-1,updatedAt:new Date().toISOString()},null)}finally{vault.close()}}
const repo=projectRepository(projectId,storage,{read:async()=>structuredClone(snapshot),execute:async()=>{throw Error('READ_ONLY_FIXTURE')},queryReceipt:async()=>null},(_key,body)=>body());await repo.open();
createRoot(document.getElementById('root')).render(React.createElement('main',{className:'p-4'},React.createElement('h1',null,'纯虚构导出验收：2 人、1 桌、1 房、跨年两晚；使用实际导出组件'),React.createElement(ExportPanel,{repo,initialKind:'guests',onClose:()=>{}}),draftMode?React.createElement(PrivateDraftPanel,{projectId,dataEpoch:'export-e'}):null));
</script></html>`
const server=await createServer({cacheDir:'/private/tmp/planner-export-review-vite',server:{host:'127.0.0.1',port:4183,strictPort:true},plugins:[{name:'export-review',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!['/__exports_review','/__exports_draft_review'].includes(req.url))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]})
await server.listen();console.log('Export review: http://127.0.0.1:4183/__exports_review')
