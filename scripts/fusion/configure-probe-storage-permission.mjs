import { execFileSync } from 'node:child_process'
import { open } from 'node:fs/promises'
import assert from 'node:assert/strict'
const [output] = process.argv.slice(2)
if(!output) throw Error('Provide a new audit report path')
const env='dev-d1gh3jw1gdf06af22'
const expression = '/^planner_fusion_probe_images\\//.test(resource.path) == false && auth != null && ((auth.uid != null && resource.openid == auth.uid) || (auth.openid != null && resource.openid == auth.openid))'
const rule={read:expression,write:expression}
function cli(args){
  let raw
  try { raw=execFileSync('tcb',['storage','rules',...args,'-e',env,'--region','ap-shanghai','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}) }
  catch(error) {
    // Preserve machine code only; CLI/SDK raw messages may contain request details.
    let code='CLI_FAILED'
    try { const text=String(error.stdout);const c=JSON.parse(text.slice(text.indexOf('{'))).error?.code;if(typeof c==='string'&&/^[A-Za-z0-9_.-]+$/.test(c))code=c } catch { /* no raw output */ }
    throw Object.assign(Error('STORAGE_RULE_FAILED'),{code})
  }
  const r=JSON.parse(raw.slice(raw.indexOf('{')));if(r.error)throw Error('STORAGE_RULE_FAILED');return r.data
}
const file=await open(output,'wx',0o600)
const report={observedAt:new Date().toISOString(),env,restrictedPrefix:'planner_fusion_probe_images/',requestedRule:rule}
try{
  report.before=cli(['get']);assert.equal(report.before.acl,'PRIVATE')
  await file.writeFile(JSON.stringify(report,null,2)+'\n')
  assert.deepEqual(cli(['get']),report.before)
  cli(['update','--acl','CUSTOM','--rule',JSON.stringify(rule)])
  report.after=cli(['get']);assert.equal(report.after.acl,'CUSTOM');assert.deepEqual(report.after.rule,rule)
  report.status='PASS'
}catch(error){report.status='FAIL';report.errorCode=error.code??'RULE_VERIFICATION_FAILED';process.exitCode=1}
await file.truncate(0);await file.write(JSON.stringify(report,null,2)+'\n',0,'utf8');await file.close()
console.log(JSON.stringify(report))
