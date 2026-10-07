// Actual field editor + IndexedDB; synthetic shared state survives reload. No cloud calls.
import { createServer } from 'vite'
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>类别与版本名称草稿验收</title><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import Editor from '/src/fusion/FusionFieldEditor.tsx';import {RepositoryContext} from '/src/fusion/RepositoryContext.ts';
import {projectRepository} from '/src/fusion/repository.ts';import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {emptyCore} from '/src/fusion/core.ts';import {coreHandlers} from '/server/fusion/coreHandlers.ts';
import {commandDigest,CommandError} from '/src/fusion/protocol.ts';import '/src/index.css';
const projectId='browser-name-draft-fixture',key='browser-name-draft-state-v1';
const state=JSON.parse(localStorage.getItem(key)||'null')||{snapshot:{role:'management',dataEpoch:'name-e',snapshotRevision:0,data:emptyCore(),notes:[],notesRevision:0},receipts:{},versions:[]};
const storage=await openIndexedDbOutbox();
const repo=projectRepository(projectId,storage,{read:async()=>structuredClone(state.snapshot),queryReceipt:async c=>state.receipts[c.operationId]||null,execute:async c=>{
const digest=await commandDigest(c);const old=state.receipts[c.operationId];if(old){if(old.requestDigest!==digest)throw new CommandError('OPERATION_ID_REUSED');return old}
if(c.dataEpoch!==state.snapshot.dataEpoch)throw new CommandError('PROJECT_REPLACED');
if(c.type==='version.save'){if(c.expectedRevisions.snapshot!==state.snapshot.snapshotRevision||c.expectedRevisions.notes!==state.snapshot.notesRevision)throw new CommandError('CONFLICT');state.versions.push({id:c.operationId,name:c.payload.name})}
else{state.snapshot.data=coreHandlers().get(c.type).apply(state.snapshot.data,c);state.snapshot.snapshotRevision++}
const receipt={projectId,dataEpoch:c.dataEpoch,operationId:c.operationId,requestDigest:digest,snapshotRevision:state.snapshot.snapshotRevision,committedAt:new Date().toISOString()};state.receipts[c.operationId]=receipt;localStorage.setItem(key,JSON.stringify(state));return receipt;
}},(key,body)=>navigator.locks.request(key,body));
function App(){const view=React.useSyncExternalStore(repo.subscribe,repo.getSnapshot);return React.createElement(RepositoryContext.Provider,{value:repo},React.createElement('main',{className:'p-6 space-y-5'},
React.createElement('h1',null,'类别与版本名称草稿：虚构服务，真实组件与 IndexedDB'),
React.createElement('p',{role:'status'},'状态：'+view.status+'；待确认：'+view.pending),
view.snapshot&&React.createElement(React.Fragment,null,
React.createElement(Editor,{kind:'group',entityId:'new',label:'类别名称',value:'',submitLabel:'保存类别'}),
React.createElement(Editor,{kind:'version',entityId:'current',label:'版本名称',value:'',submitLabel:'保存当前版本'}),
React.createElement('p',null,'共享类别：'+view.snapshot.data.config.customGroups.join('、')),
React.createElement('p',null,'共享版本数：'+state.versions.length+'；名称：'+state.versions.map(v=>v.name).join('、'))))) }
createRoot(document.getElementById('root')).render(React.createElement(App));await repo.open();
</script></html>`
const server=await createServer({cacheDir:'/private/tmp/planner-name-review-vite',server:{host:'127.0.0.1',port:4184,strictPort:true},plugins:[{name:'name-draft-review',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__name_drafts_review')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]})
await server.listen();console.log('Name drafts: http://127.0.0.1:4184/__name_drafts_review')
