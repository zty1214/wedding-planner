import cloudbase from '@cloudbase/node-sdk'
import {readFile,open} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {temporaryCredential} from './cloudbase-cli.mjs'
import {imageFileId,PROBE_PNG} from '../../server/fusion/probeImages.ts'
const [manifestPath,output]=process.argv.slice(2)
const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
if(manifest.env!=='dev-d1gh3jw1gdf06af22'||manifest.projects?.length!==2||manifest.projects.some(id=>!/^fusion-gateway-[a-f0-9-]{36}$/.test(id)))throw Error('INVALID_PROBE_MANIFEST')
const file=await open(output,'wx',0o600), report={observedAt:new Date().toISOString(),env:manifest.env,project:manifest.projects[0],requestedMaxAgeSeconds:15}
try{
 const app=cloudbase.init({env:manifest.env,region:'ap-shanghai',...temporaryCredential(manifest.env)})
 const r=await app.getTempFileURL({fileList:[{fileID:imageFileId(manifest.projects[0]),maxAge:15}]})
 assert.equal(r.fileList[0].code,'SUCCESS');const url=r.fileList[0].tempFileURL
 assert.ok(new URL(url).search.length>0)
 const before=await fetch(url,{cache:'no-store'});report.initialStatus=before.status;assert.equal(before.status,200);assert.equal(Buffer.from(await before.arrayBuffer()).toString('base64'),PROBE_PNG)
 await new Promise(resolve=>setTimeout(resolve,21000))
 const after=await fetch(url,{cache:'no-store'});report.afterWaitStatus=after.status;report.waitMs=21000
 report.status=[401,403].includes(after.status)?'PASS':'FAIL'
}catch(e){report.status='FAIL';report.errorCode=typeof e?.code==='string'&&/^[A-Za-z0-9_.-]+$/.test(e.code)?e.code:'PROBE_FAILED'}
await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.close();console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1
