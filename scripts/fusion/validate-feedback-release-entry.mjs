import {spawn} from 'node:child_process'
import {mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../../',import.meta.url)),origin=`http://127.0.0.1:${process.env.S03_PORT ?? '4294'}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:process.env.S03_PORT ?? '4294',VISUAL_SCALE_FIXTURE:'1'},stdio:'ignore'})
const report={scope:'local fictitious independent release-acceptance project only',results:{}}
try {
 let response;for(let i=0;i<180;i++){try{response=await fetch(origin+'/demo',{redirect:'manual'});if(response.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}if(response?.status!==302)throw Error('FIXTURE_START_FAILED')
 const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results';await mkdir(output,{recursive:true});const dir=join(output,'release-entry-'+Date.now())
 const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/release/verify-reused-dev-browser.mjs',dir,'--local-fixture'],{cwd:root,env:{...process.env,RELEASE_ACCEPTANCE_ORIGIN:origin},stdio:'inherit'});child.once('error',reject);child.once('exit',code=>resolve(code))});assert.equal(exit,0)
 report.results={updatedCloudAcceptanceEntryRehearsedLocally:true};await writeFile(join(output,'release-entry-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} catch(e){console.error(e.stack);process.exitCode=1} finally {fixture.kill('SIGTERM')}
