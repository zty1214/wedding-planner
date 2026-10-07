// Configured localhost preview only. Does not seed, deploy, or change permissions.
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
const config = parseEnv(await readFile(process.argv[2], 'utf8'))
if (config.VITE_CLOUDBASE_ENV_ID !== 'dev-d1gh3jw1gdf06af22' || !config.VITE_CLOUDBASE_PUBLISHABLE_KEY) throw Error('INVALID_DEV_CONFIG')
const probe = `<script>
(()=>{
 const key='fusion-network-review-v1';let counts=JSON.parse(sessionStorage.getItem(key)||'null')||{fetch:0,xhr:0,supabaseWrites:0};
 function record(url,method){try{const host=new URL(url,location.href).hostname;if(/(^|\\.)supabase\\.(co|in)$/.test(host)&&!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase()))counts.supabaseWrites++;sessionStorage.setItem(key,JSON.stringify(counts));render()}catch{}}
 function render(){let badge=document.getElementById('network-review');if(!badge&&document.body){badge=document.createElement('aside');badge.id='network-review';badge.style='position:fixed;bottom:0;right:0;background:#fff8dc;padding:6px;z-index:99999;font-size:12px;pointer-events:none';document.body.append(badge)}if(badge)badge.textContent='验收网络计数（当前标签页累计） fetch='+counts.fetch+' XHR='+counts.xhr+' Supabase写请求='+counts.supabaseWrites}
 const original=window.fetch;window.fetch=function(input,init){counts.fetch++;record(typeof input==='string'?input:input.url,init?.method||input?.method);return original.apply(this,arguments)};
 const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){this.__review={method,url};return open.apply(this,arguments)};
 const send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){counts.xhr++;if(this.__review)record(this.__review.url,this.__review.method);return send.apply(this,arguments)};
 document.addEventListener('DOMContentLoaded',render);
})();</script>`
const server=await createServer({cacheDir:'/private/tmp/planner-cloud-preview-vite',server:{host:'127.0.0.1',port:4188,strictPort:true},define:{'import.meta.env.VITE_FUSION_ENV_ID':JSON.stringify(config.VITE_CLOUDBASE_ENV_ID),'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY':JSON.stringify(config.VITE_CLOUDBASE_PUBLISHABLE_KEY)},plugins:[{name:'network-review',transformIndexHtml(html){return html.replace('<head>','<head>'+probe)}}]})
await server.listen();console.log('http://127.0.0.1:4188/fusion')
