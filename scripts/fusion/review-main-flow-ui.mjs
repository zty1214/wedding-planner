// Local browser fault harness. Real IndexedDB and repository/UI; synthetic transport only.
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
const fieldFile = new URL('../../src/fusion/fieldDrafts.ts', import.meta.url)
const fieldSource = (await readFile(fieldFile, 'utf8')).replace('export async function openFieldDraftVault(', 'async function openActualFieldDraftVault(')
const faultModule = `${fieldSource}
let releaseInitialization, failNext = false;
const initialization = new Promise(resolve => { releaseInitialization = resolve });
export function unlockInitialization() { releaseInitialization() }
export function failNextFieldSave() { failNext = true }
export async function openFieldDraftVault(factory = indexedDB) {
 await initialization;
 const vault = await openActualFieldDraftVault(factory);
 return {...vault, save: async (...args) => { if (failNext) { failNext = false; throw Error('INJECTED_QUOTA') }; return vault.save(...args) }};
}
`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>主流程本机故障验收</title><div id="root"></div>
<script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import Editor from '/src/fusion/FusionFieldEditor.tsx';
import DraftPanel from '/src/fusion/DraftPanel.tsx';
import {RepositoryContext} from '/src/fusion/RepositoryContext.ts';
import {unlockInitialization,failNextFieldSave} from '/src/fusion/fieldDrafts.ts';
import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {projectRepository} from '/src/fusion/repository.ts';
import {emptyCore} from '/src/fusion/core.ts';
import {coreHandlers} from '/server/fusion/coreHandlers.ts';
import {commandDigest,CommandError} from '/src/fusion/protocol.ts';
import '/src/index.css';
const projectId='browser-main-flow-fixture', key='planner-ui-fault-fixture-v1';
const initial=emptyCore();
initial.tables.t={id:'t',revision:0,label:'虚构第1桌',seats:10,x:100,y:100,rotation:0}; initial.tableOrder=['t'];
initial.rooms.r={id:'r',revision:0,label:'虚构001',type:'标间',notes:''}; initial.roomOrder=['r'];
let state=JSON.parse(localStorage.getItem(key)||'null') || {snapshot:{role:'management',dataEpoch:'fixture-e',snapshotRevision:0,data:initial,notes:[],notesRevision:0},receipts:{},writes:0};
let offline=false, denied=false, loseNext=false;
const persist=()=>localStorage.setItem(key,JSON.stringify(state));
function access(){if(offline)throw Error('OFFLINE');if(denied)throw new CommandError('FORBIDDEN')}
const transport={read:async()=>{access();return structuredClone(state.snapshot)},
 queryReceipt:async c=>{access();return state.receipts[c.operationId]||null},
 execute:async c=>{access();if(c.dataEpoch!==state.snapshot.dataEpoch)throw new CommandError('PROJECT_REPLACED');
 const digest=await commandDigest(c),previous=state.receipts[c.operationId];
 if(previous){if(previous.requestDigest!==digest)throw new CommandError('OPERATION_ID_REUSED');return previous}
 const data=coreHandlers().get(c.type).apply(state.snapshot.data,c);
 state.snapshot={...state.snapshot,data,snapshotRevision:state.snapshot.snapshotRevision+1};state.writes++;
 const receipt={projectId,dataEpoch:c.dataEpoch,operationId:c.operationId,requestDigest:digest,snapshotRevision:state.snapshot.snapshotRevision,committedAt:new Date().toISOString()};
 state.receipts[c.operationId]=receipt;persist();if(loseNext){loseNext=false;throw Error('LOST_RESPONSE')}return receipt;
 }};
const storage=await openIndexedDbOutbox();
const repo=projectRepository(projectId,storage,transport,(key,body)=>navigator.locks.request(key,body));
function App(){const view=React.useSyncExternalStore(repo.subscribe,repo.getSnapshot),[tick,rerender]=React.useState(0),[page,setPage]=React.useState(true);
 const button=(text,fn)=>React.createElement('button',{className:'border p-2 rounded',onClick:()=>{fn();rerender(x=>x+1)}},text);
 return React.createElement(RepositoryContext.Provider,{value:repo},React.createElement('main',{className:'p-6 space-y-4'},
 React.createElement('h1',null,'主流程故障验收：纯虚构数据，真实本机 IndexedDB，无 CloudBase'),
 React.createElement('div',{className:'flex flex-wrap gap-2'},
 button('完成本机初始化',unlockInitialization),button('下一次表单落盘失败',failNextFieldSave),
 button('模拟断网',()=>offline=true),button('恢复网络并刷新',()=>{offline=false;void repo.refresh()}),
 button('下一次保存丢响应',()=>loseNext=true),button('模拟撤权并刷新',()=>{denied=true;void repo.refresh()}),
 button('模拟另一端更改桌名',()=>{state.snapshot.data.tables.t.label='另一端桌名';state.snapshot.data.tables.t.revision++;state.snapshot.snapshotRevision++;persist()}),
 button('确认恢复并同步',()=>void repo.resume()),button('切换页面',()=>setPage(v=>!v))),
 React.createElement('p',{role:'status'},'状态：'+view.status+'；待确认：'+view.pending+'；虚构服务累计写入：'+state.writes+'；网络：'+(offline?'离线':'在线')),
 view.cacheError&&React.createElement('p',{role:'alert'},view.cacheError),
 page&&view.snapshot?React.createElement('section',{className:'space-y-4'},
 React.createElement(Editor,{kind:'project',entityId:'config',label:'项目标题',value:view.snapshot.data.config.title}),
 React.createElement(Editor,{kind:'table',entityId:'t',label:'桌名',value:view.snapshot.data.tables.t.label}),
 React.createElement(Editor,{kind:'room',entityId:'r',label:'房号',value:view.snapshot.data.rooms.r.label})):React.createElement('p',null,view.snapshot?'已切换页面':'共享安排当前不可见'),
 React.createElement(DraftPanel,{repo,onClose:()=>{}})));
}
createRoot(document.getElementById('root')).render(React.createElement(App));
await repo.open();
</script></html>`
const server = await createServer({cacheDir:'/private/tmp/planner-main-review-vite',server:{host:'127.0.0.1',port:4182,strictPort:true},plugins:[{
 name:'main-review-faults',enforce:'pre',
 load(id){if(id.endsWith('/src/fusion/fieldDrafts.ts'))return faultModule},
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__main_review')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})},
}]})
await server.listen(); console.log('Local main-flow harness: http://127.0.0.1:4182/__main_review')
