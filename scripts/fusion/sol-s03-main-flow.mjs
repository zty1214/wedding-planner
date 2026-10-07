// Local fictitious browser fixture. No CloudBase SDK, credentials, or .env files.
import { createServer } from 'vite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { MemoryStore } from '../../tests/fusion/memoryStore.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
const port = Number(process.env.S03_PORT ?? 4192)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('INVALID_S03_PORT')
const store = new MemoryStore()
const visualEntry = process.env.VISUAL_SCALE_FIXTURE === '1' ? await (await import('./visual-scale-fixture.mjs')).seedVisualScale(store) : null
const gateway = probeGateway(store, [])
const maxBytes = 1024 * 1024
const server = await createServer({
  configFile: false, envDir: false,
  define: { 'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify('sol-s03-local-fictitious-env'), 'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify('sol-s03-local-fictitious-key') },
  cacheDir: join(tmpdir(), `planner-sol-s03-vite-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'sol-s03-local-gateway', enforce: 'pre',
    load(id) {
      if (id.split('?')[0].endsWith('/src/fusion/cloudClient.ts')) return `export async function connectGateway(){return async event=>{const response=await fetch('/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});return response.json()}}`
    },
    configureServer(s) {
      if (visualEntry) s.middlewares.use((req, res, next) => {
        if (req.url !== '/demo') return next()
        res.writeHead(302, { Location: visualEntry, 'Cache-Control': 'no-store' }); res.end()
      })
      s.middlewares.use('/__sol_s03_gateway', (req, res) => {
        const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
        if (req.method !== 'POST') return reply(405, { ok: false, error: { code: 'INVALID_INPUT' } })
        let size = 0, chunks = [], rejected = false
        req.on('data', chunk => {
          size += chunk.length
          if (size > maxBytes) { if (!rejected) reply(413, { ok: false, error: { code: 'REQUEST_TOO_LARGE' } }); rejected = true; chunks = []; return }
          if (!rejected) chunks.push(chunk)
        })
        req.on('end', async () => {
          if (rejected) return
          let event
          try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
          catch { return reply(400, { ok: false, error: { code: 'INVALID_INPUT' } }) }
          try { reply(200, await gateway(event)) }
          catch { reply(500, { ok: false, error: { code: 'INTERNAL_ERROR' } }) }
        })
        req.on('error', () => { if (!res.writableEnded) reply(400, { ok: false, error: { code: 'INVALID_INPUT' } }) })
      })
    },
  }, react(), tailwindcss()],
})
await server.listen()
console.log(`S03 local fictitious main flow: http://127.0.0.1:${port}/fusion ; memory resets when process stops`)
