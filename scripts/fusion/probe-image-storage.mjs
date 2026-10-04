import cloudbase from '@cloudbase/node-sdk'
import { open, readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { temporaryCredential, functionDetail } from './cloudbase-cli.mjs'
import { PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { PROBE_PNG, imageFileId, imagePath } from '../../server/fusion/probeImages.ts'
import { browserProbeRelay } from './browser-probe-relay.mjs'
const [configPath, manifestPath, output] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide public config, deployed manifest, new report path')
const config = parseEnv(await readFile(configPath, 'utf8')), m = JSON.parse(await readFile(manifestPath, 'utf8'))
const env = 'dev-d1gh3jw1gdf06af22'
if (config.VITE_CLOUDBASE_ENV_ID !== env || m.env !== env || m.functionName !== 'planner-fusion-gateway-probe'
  || m.projects?.length !== 2 || m.projects.some(id => !/^fusion-gateway-[a-f0-9-]{36}$/.test(id))) throw Error('INVALID_FIXTURE_MANIFEST')
const file = await open(output, 'wx', 0o600)
const report = { observedAt: new Date().toISOString(), env, mode: 'REAL_BROWSER_IMAGE_PROBE', bundleSha256: m.sha256,
  projects: m.projects, cloudPaths: m.projects.map(imagePath), checks: [], observations: {} }
let stage = 'deployment', relay
try {
  const deployed = functionDetail(env, m.functionName)
  assert.equal(Object.fromEntries(deployed.Environment.Variables.map(v => [v.Key, v.Value])).FUSION_PROBE_PROJECTS, m.projects.join(','))
  const rules = () => {
    const stdout = execFileSync('tcb', ['storage', 'rules', 'get', '-e', env, '--region', 'ap-shanghai', '--json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']})
    return JSON.parse(stdout.slice(stdout.indexOf('{'))).data
  }
  report.storageRuleBefore = rules()
  const app = cloudbase.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }), db = app.database()
  const secrets = m.projects.map(() => randomBytes(32).toString('hex')), manager = randomBytes(32).toString('hex')
  async function putAccess(i, secret) {
    const r = await db.collection(PROBE_COLLECTIONS.access).doc(documentKey(m.projects[i])).set({ projectId: m.projects[i], payload: { collaborationHash: hashSecret(secret), managementHash: hashSecret(manager) } })
    assert.ok(!r.code)
  }
  stage = 'seed'
  for (const [i, id] of m.projects.entries()) {
    const current = await db.collection(PROBE_COLLECTIONS.current).doc(documentKey(id)).get()
    assert.ok(!current.code && current.data.length === 0)
    await putAccess(i, secrets[i])
    assert.ok(!(await db.collection(PROBE_COLLECTIONS.current).doc(documentKey(id)).set({projectId:id,payload:{dataEpoch:'epoch1',snapshotRevision:0,data:0}})).code)
  }
  relay = await browserProbeRelay({ env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  stage = 'browser-login'; await relay.ready()
  const req = (action, i=0, extra={}) => ({ action, projectId: m.projects[i], secret: secrets[i], fileID: imageFileId(m.projects[i]), ...extra })
  async function call(data) {
    const r = await relay.call(data)
    if (r.code) throw Object.assign(Error('FUNCTION_TRANSPORT'), {code:r.code})
    assert.equal(typeof r.result?.ok, 'boolean'); return r.result
  }
  const check = async (name, run) => { stage=name;const start=performance.now();await run();report.checks.push({name,passed:true,durationMs:Math.round(performance.now()-start)}) }
  const deny = r => assert.deepEqual(r, {ok:false,error:{code:'FORBIDDEN'}})
  await check('browser_upload_and_authorized_read_exact_fixture_bytes', async () => {
    for (const i of [0,1]) {
      const r=await call(req('image.upload',i,{base64:PROBE_PNG}));assert.equal(r.ok,true);assert.equal(r.value.fileID,imageFileId(m.projects[i]))
      assert.deepEqual(await call(req('image.read',i)),{ok:true,value:{base64:PROBE_PNG}})
    }
  })
  await check('cross_project_and_missing_credentials_cannot_upload_read_delete', async () => {
    for (const action of ['image.upload','image.read','image.delete']) for (const extra of [
      {secret:''},{secret:secrets[1]},{fileID:imageFileId(m.projects[1])},
    ]) deny(await call(req(action,0,{base64:PROBE_PNG,...extra})))
  })
  const codes = r => [r.code,...(r.fileList??[]).flatMap(x=>[x.code,x.status])].filter(x=>typeof x==='string'||typeof x==='number')
  await check('direct_client_cannot_read_overwrite_delete_server_uploaded_file', async () => {
    for (const kind of ['storage.url','storage.upload','storage.delete']) {
      const r=await relay.call({__probeClientAction:kind,fileID:imageFileId(m.projects[0]),cloudPath:imagePath(m.projects[0]),base64:PROBE_PNG})
      const cs=codes(r);report.observations[kind]={codes:cs,returnedUrl:Boolean(r.fileList?.[0]?.tempFileURL),returnedFileId:Boolean(r.fileID)}
      assert.ok(cs.some(c=>typeof c === 'string' && /AUTHORITY|PERMISSION|DENIED|UNAUTHORIZED/i.test(c)))
      assert.ok(!r.fileID && !r.fileList?.[0]?.tempFileURL)
    }
  })
  await check('fresh_direct_upload_observed_without_assuming_project_authorization', async () => {
    const cloudPath=imagePath(m.projects[0]).replace('pixel.png','anonymous-created.png')
    const r=await relay.call({__probeClientAction:'storage.upload',cloudPath,base64:PROBE_PNG})
    report.observations.freshDirectUpload={allowed:Boolean(r.fileID),codes:codes(r),cloudPath}
    if(r.fileID) {
      assert.equal(r.fileID,imageFileId(m.projects[0]).replace('pixel.png','anonymous-created.png'))
      const deleted=await app.deleteFile({fileList:[r.fileID]});assert.equal(deleted.fileList[0].code,'SUCCESS')
      report.observations.freshDirectUpload.cleaned=true
    } else assert.ok(codes(r).some(c=>/AUTHORITY|PERMISSION|DENIED/i.test(String(c))))
  })
  let signedUrl
  await check('temporary_url_is_signed_and_revocation_blocks_new_gateway_reads', async () => {
    const r=await app.getTempFileURL({fileList:[{fileID:imageFileId(m.projects[0]),maxAge:15}]})
    assert.equal(r.fileList[0].code,'SUCCESS');signedUrl=r.fileList[0].tempFileURL
    assert.ok(new URL(signedUrl).search.length>0)
    const before=await fetch(signedUrl,{cache:'no-store'});assert.equal(before.status,200)
    assert.equal(Buffer.from(await before.arrayBuffer()).toString('base64'),PROBE_PNG)
    await putAccess(0,randomBytes(32).toString('hex'))
    for(const action of ['image.read','image.upload','image.delete']) deny(await call(req(action,0,{base64:PROBE_PNG})))
    const issued=await fetch(signedUrl,{cache:'no-store'})
    report.observations.issuedUrlAfterRevocation={httpStatus:issued.status,requestedMaxAgeSeconds:15}
  })
  await check('temporary_url_expiry_observed_after_wait', async () => {
    await new Promise(resolve=>setTimeout(resolve,21000))
    const expired=await fetch(signedUrl,{cache:'no-store'})
    report.observations.expiredUrl={httpStatus:expired.status,waitMs:21000}
    assert.ok([401,403].includes(expired.status))
  })
  await check('authorized_exact_file_deletion_and_missing_object_readback', async () => {
    assert.deepEqual(await call(req('image.delete',0,{secret:manager})),{ok:true,value:{deleted:true}})
    assert.deepEqual(await call(req('image.delete',1)),{ok:true,value:{deleted:true}})
    for(const id of m.projects){
      const urls=await app.getTempFileURL({fileList:[{fileID:imageFileId(id),maxAge:15}]})
      if(urls.fileList[0].tempFileURL){const r=await fetch(urls.fileList[0].tempFileURL,{cache:'no-store'});assert.ok([403,404].includes(r.status))}
      else assert.notEqual(urls.fileList[0].code,'SUCCESS')
    }
  })
  report.storageRuleAfter=rules();assert.deepEqual(report.storageRuleAfter,report.storageRuleBefore)
  report.status=report.observations.freshDirectUpload.allowed?'PARTIAL':'PASS'
  report.scope='Fixed synthetic PNG platform probe. PRIVATE may permit unauthorized fresh uploads; see observations. No production attachment lifecycle, references, retries, large-file or mobile validation.'
} catch(e){report.status='FAIL';report.failedStage=stage;report.errorCode=typeof e?.code==='string'&&/^[A-Za-z0-9_.-]+$/.test(e.code)?e.code:'PROBE_FAILED';process.exitCode=1}
finally{relay?.finish(report);await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.close()}
console.log(JSON.stringify(report))
