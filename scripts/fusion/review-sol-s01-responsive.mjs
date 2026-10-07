// S01: actual pages, Provider, repository and IndexedDB; synthetic local transport only.
// node scripts/fusion/review-sol-s01-responsive.mjs → http://127.0.0.1:4190/__sol_s01
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>S01 本地响应式验收</title><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import Guests from '/src/pages/GuestsPage.tsx'; import Rooms from '/src/pages/AccommodationPage.tsx'; import Notes from '/src/pages/NotesPage.tsx';
import {PageStoreContext} from '/src/fusion/PageContext.tsx'; import {RepositoryContext} from '/src/fusion/RepositoryContext.ts';
import {createPageStore} from '/src/fusion/pageStore.ts'; import {projectRepository} from '/src/fusion/repository.ts'; import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {emptyCore} from '/src/fusion/core.ts'; import {projectDraft} from '/src/fusion/projectDraft.ts'; import {commandDigest,CommandError} from '/src/fusion/protocol.ts'; import '/src/index.css';
const projectId='sol-s01-local-responsive-v1', data=emptyCore();
data.config.customGroups=['虚构超长分组ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']; data.config.stayDates=['2026-12-31','2027-01-01','2027-01-02'];
data.tables.t={id:'t',revision:0,label:'虚构长桌名ABCDEFGHIJKLMNOPQRSTUVWXYZ',seats:10,x:0,y:0,rotation:0}; data.tableOrder=['t'];
data.rooms.r={id:'r',revision:0,label:'虚构房间001ABCDEFGHIJKLMNOPQRSTUVWXYZ',type:'标间',notes:''};data.roomOrder=['r'];
for(let i=0;i<3;i++){const id='g'+i;data.guests[id]={id,revision:0,name:i===0?'虚构长姓名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789':'虚构宾客'+i,group:i===0?data.config.customGroups[0]:'新娘亲属',phone:'001380000000'+i,notes:'',side:'bride',attendance:'confirmed',tableId:i===0?'t':null,seatIndex:i===0?0:null,roomId:i===0?'r':null,stayNeed:'needed',stayDates:i===0?['2026-12-31','2027-01-01']:[]};data.guestOrder.push(id)}
let snapshot={role:'management',dataEpoch:'sol-s01-e',snapshotRevision:0,data,notesRevision:0,notes:[{id:'n',revision:0,category:'酒店',title:'虚构酒店对比'+ 'TITLE'.repeat(15),content:'跨年住宿备注：长文本完整可见。\\n'+ 'https://fictional.invalid/'.repeat(40),createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z'}]}; const receipts=new Map();
const transport={read:async()=>structuredClone(snapshot),queryReceipt:async c=>receipts.get(c.operationId)||null,execute:async c=>{const digest=await commandDigest(c),prior=receipts.get(c.operationId);if(prior){if(prior.requestDigest!==digest)throw new CommandError('OPERATION_ID_REUSED');return prior}snapshot={...projectDraft(snapshot,c).snapshot,snapshotRevision:snapshot.snapshotRevision+1};const receipt={projectId,dataEpoch:c.dataEpoch,operationId:c.operationId,requestDigest:digest,snapshotRevision:snapshot.snapshotRevision,notesRevision:snapshot.notesRevision,committedAt:new Date().toISOString()};receipts.set(c.operationId,receipt);return receipt}};
const outbox=await openIndexedDbOutbox(),repo=projectRepository(projectId,outbox,transport,(key,body)=>navigator.locks.request(key,body));await repo.open();const {store}=createPageStore(projectId,repo,console.info);
function App(){const [page,setPage]=React.useState('名单');return React.createElement(RepositoryContext.Provider,{value:repo},React.createElement(PageStoreContext.Provider,{value:store},React.createElement('div',{className:'h-dvh flex flex-col bg-[#faf9f7]'},React.createElement('nav',{className:'flex flex-wrap gap-3 p-3 shrink-0'},...['名单','住宿','笔记'].map(p=>React.createElement('button',{key:p,onClick:()=>setPage(p)},p))),React.createElement('main',{'data-s01-page':page,className:'flex-1 overflow-hidden min-h-0 min-w-0'},React.createElement(page==='名单'?Guests:page==='住宿'?Rooms:Notes)))))}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script></html>`
const server=await createServer({configFile:false,cacheDir:'/private/tmp/sol-s01-vite',server:{host:'127.0.0.1',port:4190,strictPort:true},plugins:[react(),tailwindcss(),{name:'sol-s01-local',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__sol_s01')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]})
await server.listen();console.log('http://127.0.0.1:4190/__sol_s01')
