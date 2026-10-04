// Ephemeral loopback UI fixture: credentials only in memory; no real wedding records.
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import cloudbase from '@cloudbase/node-sdk'
import { temporaryCredential, functionDetail, cloudApi } from './cloudbase-cli.mjs'
import { emptyCore } from '../../src/fusion/core.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
const [configPath, manifestPath] = process.argv.slice(2)
const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const env = 'dev-d1gh3jw1gdf06af22'
assert.equal(config.VITE_CLOUDBASE_ENV_ID, env); assert.equal(manifest.env, env)
assert.equal(manifest.functionName, 'planner-fusion-gateway-probe')
assert.equal(manifest.projects.length, 2)
for (const id of manifest.projects) assert.match(id, /^fusion-gateway-[a-f0-9-]{36}$/)
const detail = functionDetail(env, manifest.functionName)
const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
assert.equal(detail.Status, 'Active'); assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(',')); assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
for (const name of Object.values(PROBE_COLLECTIONS)) assert.equal(cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: name }).AclTag, 'ADMINONLY')
const db = cloudbase.init({ env, region: 'ap-shanghai', ...temporaryCredential(env) }).database()
const secret = randomBytes(32).toString('hex'), projectId = manifest.projects[0], nonce = randomBytes(32).toString('hex')
const ref = kind => db.collection(PROBE_COLLECTIONS[kind]).doc(documentKey(projectId))
const exists = await ref('current').get(); assert.ok(!exists.code && exists.data.length === 0)
for (const [kind, payload] of [['access', { collaborationHash: hashSecret(secret), managementHash: hashSecret(randomBytes(32).toString('hex')) }], ['current', { dataEpoch: 'ui-epoch', snapshotRevision: 0, data: emptyCore() }]]) {
  const r = await ref(kind).set({ projectId, payload }); assert.ok(!r.code)
}
const port = 4180, host = `127.0.0.1:${port}`
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, define: {
  'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify(env),
  'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify(config.VITE_CLOUDBASE_PUBLISHABLE_KEY),
}, plugins: [{ name: 'isolated-ui-fixture', configureServer(vite) {
  vite.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith('/__fusion_fixture')) return next()
    if (req.headers.host !== host) { res.statusCode = 403; res.end(); return }
    res.setHeader('Cache-Control', 'no-store')
    if (req.url === '/__fusion_fixture/session' && req.method === 'POST') {
      if (req.headers.origin !== `http://${host}` || req.headers['x-fixture-nonce'] !== nonce) { res.statusCode = 403; res.end(); return }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ projectId, secret })); return
    }
    if (req.url !== '/__fusion_fixture' || req.method !== 'GET') { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<h1>主流程隔离测试</h1><p>只使用新建虚构项目，不接触真实婚礼数据。</p><button id="open">打开测试项目</button><script>document.querySelector('button').onclick=async()=>{const r=await fetch('/__fusion_fixture/session',{method:'POST',headers:{'X-Fixture-Nonce':'${nonce}'}});if(!r.ok)return;const x=await r.json();sessionStorage.setItem('planner-access:'+x.projectId,x.secret);location.href='/fusion/p/'+x.projectId+'/guests'}</script>`)
  })
} }] })
await server.listen()
console.log(`UI fixture ready: http://${host}/__fusion_fixture`)
