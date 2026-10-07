// Explicit localhost-only recovery fixture: real App/IndexedDB/gateway, fictitious memory data.
// node --experimental-strip-types scripts/fusion/review-main-flow-recovery.mjs
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile } from 'node:fs/promises'
import { MemoryStore } from '../../tests/fusion/memoryStore.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
const store = new MemoryStore(), gateway = probeGateway(store, [])
let offline = false, loseNext = null, lostResponses = 0
const port = 4194, route = '/__recovery_gateway', control = '/__recovery_control'
const stats = () => ({ offline, loseNext, lostResponses, projects: store.projects.size,
  receipts: [...store.projects.values()].reduce((n, p) => n + p.receipts.size, 0),
  guests: [...store.projects.values()].reduce((n, p) => n + (p.current.data.guestOrder?.length ?? 0), 0), notes: [...store.projects.values()].reduce((n, p) => n + p.notes.size, 0) })
const draftModules = new Map()
for (const name of ['Guest', 'Note', 'Field']) {
  const path = `/src/fusion/${name.toLowerCase()}Drafts.ts`
  const source = (await readFile(new URL(`../../${path.slice(1)}`, import.meta.url), 'utf8'))
    .replace(`export async function open${name}DraftVault(`, `async function openActual${name}DraftVault(`)
  draftModules.set(path, `${source}\nexport async function open${name}DraftVault(factory = indexedDB) { const vault = await openActual${name}DraftVault(factory); return {...vault, save: async (...args) => { if (localStorage.getItem('recovery-storage-fail') === 'yes' || (args[0]?.handoff && localStorage.getItem('recovery-handoff-fail') === 'yes')) throw Error('INJECTED_LOCAL_SAVE_FAILURE'); const saved = await vault.save(...args); if (args[0]?.handoff && localStorage.getItem('recovery-handoff-pause') === 'yes') { localStorage.setItem('recovery-handoff-paused', 'yes'); await new Promise(() => {}) }; return saved }, remove: async (...args) => { if (localStorage.getItem('recovery-cleanup-fail') === 'yes') throw Error('INJECTED_LOCAL_CLEANUP_FAILURE'); if (localStorage.getItem('recovery-cleanup-pause') === 'yes') { localStorage.setItem('recovery-cleanup-paused', 'yes'); await new Promise(() => {}) }; return vault.remove(...args) }} }`)
}
const toolbar = `<script type="module">
const bar=document.createElement('aside');bar.setAttribute('aria-label','本地故障验收控制');bar.style='padding:8px;background:#fff8dc;display:flex;gap:8px;flex-wrap:wrap';
const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('data-recovery-stats','');status.style='width:100%;font-size:12px';bar.append(status);
async function update(mode){const r=await fetch('${control}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});const v=await r.json();status.textContent='仅本地虚构：项目 '+v.projects+'，宾客 '+v.guests+'，回执 '+v.receipts+'，丢响应 '+v.lostResponses+'，网络 '+(v.offline?'离线':'在线')+'，待丢 '+(v.loseNext||'无');}
for(const [label,mode] of [['模拟断网','offline'],['恢复网络','online'],['下一次创建丢响应','lose-create'],['下一次轮换丢响应','lose-rotate'],['下一次恢复丢响应','lose-restore'],['下一次宾客修改丢响应','lose-guest-update'],['读取验收计数','stats']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>update(mode);bar.append(b)}
for(const [label,failed] of [['模拟表单保存失败',true],['恢复表单存储',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(failed)localStorage.setItem('recovery-storage-fail','yes');else localStorage.removeItem('recovery-storage-fail');status.textContent=failed?'本地故障注入：表单保存失败':'表单本机存储已恢复';};bar.append(b)}
for(const [label,key,failed] of [['模拟交接保存失败','recovery-handoff-fail',true],['恢复交接保存','recovery-handoff-fail',false],['模拟表单清理失败','recovery-cleanup-fail',true],['恢复表单清理','recovery-cleanup-fail',false],['冻结已落盘后暂停','recovery-handoff-pause',true],['恢复交接暂停','recovery-handoff-pause',false],['清理前暂停','recovery-cleanup-pause',true],['恢复清理暂停','recovery-cleanup-pause',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(failed)localStorage.setItem(key,'yes');else localStorage.removeItem(key);status.textContent=label;};bar.append(b)}
document.body.prepend(bar);await update('stats');
</script>`
const server = await createServer({ configFile: false, envDir: false,
  define: { 'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify('recovery-local-fictional-env'), 'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify('recovery-local-fictional-key') },
  cacheDir: '/private/tmp/planner-main-flow-recovery-vite', server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{ name: 'main-flow-recovery', enforce: 'pre',
    load(id) {
      const path = id.split('?')[0]
      if (path.endsWith('/src/fusion/cloudClient.ts')) return `export async function connectGateway(){return async event=>{const r=await fetch('${route}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});if(!r.ok)throw Error('LOCAL_TRANSPORT_INTERRUPTED');return r.json()}}`
      for (const [suffix, source] of draftModules) if (path.endsWith(suffix)) return source
    },
    transformIndexHtml(html) { return html.replace('</body>', `${toolbar}</body>`) },
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      if (![route, control].includes(req.url)) return next()
      const reply = (code, value) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
      if (req.method !== 'POST') return reply(405, { error: 'INVALID_INPUT' })
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return reply(403, { error: 'FORBIDDEN' })
      let bytes = 0, chunks = []
      try {
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) return reply(413, { error: 'REQUEST_TOO_LARGE' }); chunks.push(chunk) }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (req.url === control) {
          const { mode } = input
          if (!['stats', 'offline', 'online', 'lose-create', 'lose-rotate', 'lose-restore', 'lose-guest-update'].includes(mode)) return reply(400, { error: 'INVALID_INPUT' })
          if (mode === 'offline') offline = true
          if (mode === 'online') offline = false
          if (mode.startsWith('lose-')) loseNext = { 'lose-create': 'project.create', 'lose-rotate': 'access.rotateCollaboration', 'lose-restore': 'version.restore', 'lose-guest-update': 'guest.update' }[mode]
          return reply(200, stats())
        }
        if (offline) return reply(503, { error: 'INJECTED_OFFLINE' })
        const kind = input.action === 'project.create' ? 'project.create' : input.action === 'execute' ? input.command?.type : null
        const result = await gateway(input)
        if (kind && result.ok && kind === loseNext) { loseNext = null; lostResponses++; return reply(503, { error: 'INJECTED_LOST_RESPONSE' }) }
        return reply(200, result)
      } catch { return reply(400, { error: 'LOCAL_REQUEST_FAILED' }) }
    }) },
  }, react(), tailwindcss()],
})
await server.listen()
console.log(`Recovery fictitious fixture: http://127.0.0.1:${port}/fusion (no cloud; memory resets on process stop)`)
