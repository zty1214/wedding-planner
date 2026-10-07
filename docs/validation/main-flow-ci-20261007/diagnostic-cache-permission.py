# Diagnostic only: Node 25 permission model + installed Playwright; disposable local fixture.
import os,subprocess,time,urllib.request,urllib.error,tempfile,json,socket
from pathlib import Path
with socket.socket() as guard:
 guard.bind(('127.0.0.1',4208))
cache=tempfile.mkdtemp(prefix='planner-ci-writable-cache-')
e=os.environ.copy(); e.update(S03_PORT='4208',TMPDIR=cache)
args=['node','--permission','--allow-fs-read=*','--allow-fs-write='+cache,'--allow-addons','--allow-worker','--allow-net','--experimental-strip-types','scripts/fusion/sol-s03-main-flow.mjs']
p=subprocess.Popen(args,env=e,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
status=None; body=''
try:
 for i in range(100):
  if p.poll() is not None: break
  try:
   urllib.request.urlopen('http://127.0.0.1:4208/fusion',timeout=.3).read(); break
  except (OSError,urllib.error.URLError): time.sleep(.1)
 try:
  with urllib.request.urlopen('http://127.0.0.1:4208/src/main.tsx',timeout=10) as r: status=r.status;body=r.read().decode()
 except urllib.error.HTTPError as err: status=err.code;body=err.read().decode()
 except OSError as err: body=type(err).__name__
 probe = subprocess.run(['node','--input-type=module','-e', """
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext();
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4208'?route.continue():route.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:4208/fusion');
 let rendered=false;try {await page.getByLabel('新项目名称').waitFor({timeout:4000});rendered=true;}catch {}
 console.log(JSON.stringify({creationFormRendered:rendered}));
}finally{await browser.close();}
"""],capture_output=True,text=True,timeout=15)
 rendered=json.loads(probe.stdout)['creationFormRendered']
finally:
 if p.poll() is None: p.terminate()
 try: logs=p.communicate(timeout=5)[0]
 except subprocess.TimeoutExpired: p.kill();logs=p.communicate()[0]
print('\n'.join(line for line in logs.splitlines() if any(term in line for term in ('ERR_ACCESS_DENIED','resource:', 'permission:', 'Error:', 'EACCES'))))
proof={'creationFormRendered':rendered,'moduleStatus':status,'deniedCachePath': '/private/tmp/planner-sol-s03-vite-4208' in body+logs,'permissionDenied':any(s in body+logs for s in ('ERR_ACCESS_DENIED','EACCES','permission denied','--allow-fs-write')),'writableTemporaryDirectory':cache}
Path('/private/tmp/planner-ci-cache-smoke.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
raise SystemExit(0 if rendered and not proof['permissionDenied'] else 1)
