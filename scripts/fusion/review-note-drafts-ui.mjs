// Local-only fault harness: no gateway, credentials, or persisted project data.
// Run node scripts/fusion/review-note-drafts-ui.mjs, then /__note_review.
import { createServer } from 'vite'
const mock = `
let release, fail = false;
const ready = new Promise(resolve => { release = resolve });
let values = [{id:'existing',projectId:'review',entityId:'existing-note',dataEpoch:'e',noteId:null,noteRevision:null,category:'备忘',title:'另一份草稿',content:'已保存的另一份内容',revision:0,updatedAt:new Date().toISOString()}];
export const unlock = () => release();
export const setFailure = value => { fail = value };
export async function openNoteDraftVault() {
 await ready;
 return {list:async()=>structuredClone(values),close(){},
 save:async(value,revision)=>{if(fail)throw Error('QUOTA'); const saved={...value,revision:(revision??-1)+1}; values=values.filter(v=>v.id!==saved.id).concat(saved);return saved},
 remove:async(value)=>{values=values.filter(v=>v.id!==value.id)}};
}`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>笔记草稿故障回归</title><div id="root"></div>
<script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import Editor from '/src/fusion/FusionNotesEditor.tsx';
import {RepositoryContext} from '/src/fusion/RepositoryContext.ts';
import {unlock,setFailure} from '/src/fusion/noteDrafts.ts';
import '/src/index.css';
let submissions=0;
const repo={projectId:'review',getSnapshot:()=>({snapshot:{dataEpoch:'e',notes:[]}}),dispatch:async()=>{submissions++;return true}};
function Harness(){const [open,setOpen]=React.useState(true),[count,setCount]=React.useState(0);return React.createElement('main',{className:'p-6'},
 React.createElement('h1',null,'本机笔记故障回归（纯虚构内存数据）'),
 React.createElement('a',{href:'/should-not-navigate'},'模拟顶部导航'), ' | ',
 React.createElement('button',{'data-note-editor-switch':true,onClick:()=>setOpen(false)},'模拟切换笔记'), ' | ',
 React.createElement('button',{onClick:unlock},'完成数据库初始化'), ' | ',
 React.createElement('button',{onClick:()=>setFailure(true)},'模拟落盘失败'), ' | ',
 React.createElement('button',{onClick:()=>setFailure(false)},'恢复本机存储'), ' | ',
 React.createElement('button',{onClick:()=>setOpen(true)},'重新打开编辑器'),
 React.createElement('button',{onClick:()=>setCount(submissions)},'查看提交次数'),
 React.createElement('p',null,'命令提交次数：'+count),
 open?React.createElement(RepositoryContext.Provider,{value:repo},React.createElement(Editor,{category:'备忘',noteId:null,onClose:()=>setOpen(false)})):React.createElement('p',null,'编辑器已关闭'));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></html>`
const server = await createServer({cacheDir:'/private/tmp/planner-note-review-vite',server:{host:'127.0.0.1',port:4185,strictPort:true},plugins:[{
 name:'note-review-faults',enforce:'pre',
 load(id){if(id.endsWith('/src/fusion/noteDrafts.ts'))return mock},
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__note_review')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,html))})},
}]})
await server.listen(); console.log('Local fault harness: http://127.0.0.1:4185/__note_review')
