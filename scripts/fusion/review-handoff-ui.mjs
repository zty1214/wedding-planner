// Local-only browser acceptance: actual forms, repository and IndexedDB; synthetic service.
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
const modules = new Map()
for (const name of ['Guest', 'Note', 'Field']) {
 const path = `/src/fusion/${name.toLowerCase()}Drafts.ts`
 const source = (await readFile(new URL(`../../${path.slice(1)}`, import.meta.url), 'utf8')).replace(`export async function open${name}DraftVault(`, `async function openActual${name}DraftVault(`)
 modules.set(path, `${source}\nexport async function open${name}DraftVault(factory = indexedDB) { const vault = await openActual${name}DraftVault(factory); return {...vault, remove: async value => { if (localStorage.getItem('handoff-fail-cleanup') === 'yes') throw Error('INJECTED_CLEANUP_FAILURE'); return vault.remove(value) }} }`)
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>表单交接验收</title><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import Guest from '/src/fusion/FusionGuestForm.tsx'; import Note from '/src/fusion/FusionNotesEditor.tsx'; import Field from '/src/fusion/FusionFieldEditor.tsx';
import {RepositoryContext} from '/src/fusion/RepositoryContext.ts'; import {openIndexedDbOutbox} from '/src/fusion/indexedDbOutbox.ts';
import {projectRepository} from '/src/fusion/repository.ts'; import {projectDraft} from '/src/fusion/projectDraft.ts';
import {emptyCore} from '/src/fusion/core.ts'; import {commandDigest,CommandError} from '/src/fusion/protocol.ts'; import '/src/index.css';
const projectId='browser-handoff-fixture', key='browser-handoff-fixture-v1';
let state=JSON.parse(localStorage.getItem(key)||'null') || {snapshot:{role:'management',dataEpoch:'e',snapshotRevision:0,data:emptyCore(),notes:[],notesRevision:0},receipts:{},writes:0};
const persist=()=>localStorage.setItem(key,JSON.stringify(state));
const transport={read:async()=>structuredClone(state.snapshot),queryReceipt:async c=>state.receipts[c.operationId]||null,
 execute:async c=>{const digest=await commandDigest(c), prior=state.receipts[c.operationId]; if(prior){if(prior.requestDigest!==digest)throw new CommandError('OPERATION_ID_REUSED');return prior}
 if(c.dataEpoch!==state.snapshot.dataEpoch)throw new CommandError('PROJECT_REPLACED');
 state.snapshot={...projectDraft(state.snapshot,c).snapshot,snapshotRevision:state.snapshot.snapshotRevision+1}; state.writes++;
 const receipt={projectId,dataEpoch:c.dataEpoch,operationId:c.operationId,requestDigest:digest,snapshotRevision:state.snapshot.snapshotRevision,notesRevision:state.snapshot.notesRevision,committedAt:new Date().toISOString()};state.receipts[c.operationId]=receipt;persist();return receipt;
 }};
const storage=await openIndexedDbOutbox(),repo=projectRepository(projectId,storage,transport,(key,body)=>navigator.locks.request(key,body));
function App(){const view=React.useSyncExternalStore(repo.subscribe,repo.getSnapshot),[note,setNote]=React.useState(true),[tick,setTick]=React.useState(0);
 return React.createElement(RepositoryContext.Provider,{value:repo},React.createElement('main',{className:'p-6 space-y-5'},
 React.createElement('h1',null,'表单交接：纯虚构服务 + 真实 IndexedDB'),
 React.createElement('button',{onClick:()=>{localStorage.setItem('handoff-fail-cleanup','yes');setTick(tick+1)}},'启用表单清理失败'),
 React.createElement('button',{onClick:()=>{localStorage.removeItem('handoff-fail-cleanup');setTick(tick+1)}},'恢复表单清理'),
 React.createElement('p',{role:'status'},'虚构服务累计写入：'+state.writes+'；状态：'+view.status+'；清理故障：'+(localStorage.getItem('handoff-fail-cleanup')==='yes'?'开':'关')),
 view.snapshot&&React.createElement(React.Fragment,null,
 React.createElement('section',null,React.createElement('h2',null,'宾客'),React.createElement(Guest,{groups:['朋友'],onAddGroup:()=>{}})),
 React.createElement('section',null,React.createElement('h2',null,'项目标题'),React.createElement(Field,{kind:'project',entityId:'config',label:'项目标题',value:view.snapshot.data.config.title})),
 React.createElement('section',null,React.createElement('h2',null,'笔记'),note?React.createElement(Note,{category:'备忘',noteId:null,onClose:()=>setNote(false)}):React.createElement('button',{onClick:()=>setNote(true)},'重开笔记')),
 React.createElement('pre',null,JSON.stringify({guests:view.snapshot.data.guests,notes:view.snapshot.notes,title:view.snapshot.data.config.title},null,2))))) }
createRoot(document.getElementById('root')).render(React.createElement(App));await repo.open();
</script></html>`
const server=await createServer({cacheDir:'/private/tmp/planner-handoff-vite',server:{host:'127.0.0.1',port:4187,strictPort:true},plugins:[{name:'handoff-review',enforce:'pre',load(id){for(const [path,source]of modules)if(id.endsWith(path))return source},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__handoff_review')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})}}]});
await server.listen();console.log('http://127.0.0.1:4187/__handoff_review')
