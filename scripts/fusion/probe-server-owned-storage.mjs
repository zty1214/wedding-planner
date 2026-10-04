import cloudbase from '@cloudbase/node-sdk'
import {randomUUID} from 'node:crypto'
import {parseEnv} from 'node:util'
import {open,readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {temporaryCredential} from './cloudbase-cli.mjs'
import {PROBE_PNG,imageFileId,imagePath} from '../../server/fusion/probeImages.ts'
import {browserProbeRelay} from './browser-probe-relay.mjs'
const [configPath,output]=process.argv.slice(2)
if(!configPath||!output)throw Error('Provide public config and fresh report path')
const c=parseEnv(await readFile(configPath,'utf8')),env='dev-d1gh3jw1gdf06af22'
if(c.VITE_CLOUDBASE_ENV_ID!==env)throw Error('UNEXPECTED_ENV')
const file=await open(output,'wx',0o600),project=`fusion-gateway-${randomUUID()}`,fileID=imageFileId(project)
const report={observedAt:new Date().toISOString(),env,project,fileID,mode:'LOCAL_ADMIN_UPLOAD_REAL_BROWSER_ACCESS',checks:[]}
let relay,stage='admin-upload'
try{
 const app=cloudbase.init({env,region:'ap-shanghai',...temporaryCredential(env)})
 const r=await app.uploadFile({cloudPath:imagePath(project),fileContent:Buffer.from(PROBE_PNG,'base64')})
 assert.equal(r.fileID,fileID);report.checks.push({name:'server_without_end_user_context_uploaded_fixture',passed:true})
 relay=await browserProbeRelay({env,region:'ap-shanghai',accessKey:c.VITE_CLOUDBASE_PUBLISHABLE_KEY})
 stage='browser-login';await relay.ready()
 stage='anonymous-direct-url'
 const result=await relay.call({__probeClientAction:'storage.url',fileID})
 report.urlResult={code:result.code??null,itemCode:result.fileList?.[0]?.code??null,returnedUrl:Boolean(result.fileList?.[0]?.tempFileURL)}
 if(result.fileList?.[0]?.tempFileURL){
  const download=await fetch(result.fileList[0].tempFileURL,{cache:'no-store'})
  report.urlResult.httpStatus=download.status
  report.urlResult.matchesFixture=Buffer.from(await download.arrayBuffer()).toString('base64')===PROBE_PNG
 }
 for(const kind of ['storage.upload','storage.delete']){
  stage=kind
  const x=await relay.call({__probeClientAction:kind,fileID,cloudPath:imagePath(project),base64:PROBE_PNG})
  report[kind]={code:x.code??null,itemCodes:(x.fileList??[]).map(v=>v.code??v.status??null),returnedFileID:Boolean(x.fileID)}
 }
 stage='cleanup'
 const cleanup=await app.deleteFile({fileList:[fileID]})
 report.cleanupCodes=cleanup.fileList?.map(x=>x.code)
 report.status=report.urlResult.matchesFixture?'ACCESS_ISOLATION_FAILED':'ACCESS_RESULT_REQUIRES_REVIEW'
 process.exitCode=1 // This diagnostic has not established a passing isolation result.
 report.scope='No cloud-function caller context used for upload. Direct browser access tested; no new storage rules, paid resources, or real files.'
}catch(e){report.status='FAIL';report.failedStage=stage;report.errorCode=typeof e?.code==='string'&&/^[A-Za-z0-9_.-]+$/.test(e.code)?e.code:'PROBE_FAILED';process.exitCode=1}
finally{relay?.finish(report);await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.close()}
console.log(JSON.stringify(report))
