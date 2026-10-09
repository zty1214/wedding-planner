import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {writeFile,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
const output=process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results'
await mkdir(output,{recursive:true})
const {chromium}=createRequire(root+'/package.json')('playwright')
const port=process.env.S03_PORT ?? '4398'
const origin=`http://127.0.0.1:${port}`
const fixture=spawn(process.execPath,['--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs'],{cwd:root,env:{...process.env,S03_PORT:port,VISUAL_SCALE_FIXTURE:'1'},stdio:'ignore'})
let browser
try {
 let r;for(let i=0;i<180;i++){try{r=await fetch(origin+'/demo',{redirect:'manual'});if(r.status===302)break}catch{}await new Promise(r=>setTimeout(r,100))}
 if(r?.status!==302)throw Error('fixture not ready')
 browser=await chromium.launch({headless:true});let results=[]
 for(const width of [360,390,430,768,1280]){
 for(const rootSize of [16,20]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.goto(new URL(r.headers.get('location'),origin).href);await page.getByText('已同步到云端',{exact:true}).waitFor()
 await page.addStyleTag({content:`html{font-size:${rootSize}px}`});
 for(const name of ['宾客名单','住宿安排','备婚笔记','座位安排']){
 await page.getByRole('link',{name,exact:true}).click()
 await page.locator(name==='宾客名单'?'.planner-guests':name==='住宿安排'?'.planner-stay':name==='备婚笔记'?'.planner-notes':'.konvajs-content').waitFor()
 results.push({width,rootSize,page:name,...await page.evaluate(()=>{
 const font=s=>{const e=document.querySelector(s);return e?{size:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}:null}
 const b=document.querySelector('[data-guest-form-switch]');let lines=null
 if(b&&b.getClientRects().length){const range=document.createRange();range.selectNodeContents(b);lines=range.getClientRects().length}
 return {heading:font('.planner-page h2'),description:font('.planner-description'),add:font('[data-guest-form-switch]'),lines,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.planner-page button,.planner-seating-tools select')].filter(e=>e.getClientRects().length).slice(0,6).map(e=>({text:e.textContent.trim().slice(0,20),font:getComputedStyle(e).fontSize})),rootFont:getComputedStyle(document.documentElement).fontSize}
 })})
 if(width===390&&rootSize===16)await page.screenshot({path:join(output,`mobile-typography-${name}.png`)})
 }
 await page.close()
 }
 }
 await writeFile(join(output,'mobile-typography-report.json'),JSON.stringify({scope:'local fictitious project only; Chromium viewport and default-font stress, not real WeChat',results},null,2));console.log(JSON.stringify({scenarios:results.length,output}))
 if(results.some(r=>r.width<768&&r.lines>1))throw Error('ADD_GUEST_WRAPS')
}finally{await browser?.close();fixture.kill('SIGTERM')}
