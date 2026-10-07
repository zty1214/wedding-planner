// Browser delivery check using the actual export panel and a fixed synthetic snapshot.
import { createServer } from 'vite'
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>固定版本导出验收</title><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import ExportPanel from '/src/fusion/ExportPanel.tsx';
import PrivateDraftPanel from '/src/fusion/PrivateDraftPanel.tsx';
import {removeCore} from '/src/fusion/removeCore.ts';
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
const whole=location.pathname==='/__whole_restore_export';const draftMode=false;
const projectId=whole?'browser-whole-restore-export':'browser-recycle-restore-export';
core.config.title=whole?'纯虚构整项目恢复导出':'纯虚构回收恢复导出';
const target={id:'target-version',name:'目标安排',kind:'manual',status:'ready',dataEpoch:'old-target',snapshotRevision:2,notesRevision:0,capturedAt:new Date().toISOString(),businessDate:'2026-10-07',expiresAt:null,counts:{guests:2,tables:1,rooms:1,notes:0},schemaVersion:1,core:structuredClone(core),notes:[],noteRetiredIds:[]};
target.core.guests.g1.name='恢复目标姓名 2';
const changes=removeCore(core,{projectId,dataEpoch:'export-e',operationId:'delete-table',commandVersion:1,type:'table.deleteWithGuests',payload:{id:'t'},expectedRevisions:{'table:t':0,'guest:g0':0,'guest:g1':0}});
const record={id:'delete-table',dataEpoch:'export-e',type:'table.deleteWithGuests',createdAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00.000Z',restoredAt:null,changes};
await storage.insert({status:'prepared',command:{projectId,dataEpoch:'export-e',operationId:'pending-restore',commandVersion:1,type:whole?'version.restore':'recycle.restore',payload:{id:whole?target.id:record.id},expectedRevisions:whole?{snapshot:7,notes:0}:{'guest:g0':1,'guest:g1':1}}});
const repo=projectRepository(projectId,storage,{read:async()=>structuredClone(snapshot),execute:async()=>{throw Error('READ_ONLY_FIXTURE')},queryReceipt:async()=>null,readRecycle:async()=>({dataEpoch:'export-e',records:structuredClone([record])}),readVersion:async()=>structuredClone(target)},(_key,body)=>body());await repo.open();
createRoot(document.getElementById('root')).render(React.createElement('main',{className:'p-4'},React.createElement('h1',null,whole?'整项目恢复导出验收（虚构）':'回收恢复导出验收（虚构）'),React.createElement(ExportPanel,{repo,initialKind:'guests',onClose:()=>{}}),draftMode?React.createElement(PrivateDraftPanel,{projectId,dataEpoch:'export-e'}):null));
</script></html>`
const server=await createServer({cacheDir:'/private/tmp/planner-restore-export-vite',server:{host:'127.0.0.1',port:4186,strictPort:true},plugins:[{name:'export-review',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!['/__whole_restore_export','/__recycle_restore_export'].includes(req.url))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]})
await server.listen();console.log('Export review: http://127.0.0.1:4186/__whole_restore_export')
