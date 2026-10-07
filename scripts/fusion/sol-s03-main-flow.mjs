// Local fictitious browser fixture. No CloudBase SDK, credentials, or .env files.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { MemoryStore } from '../../tests/fusion/memoryStore.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
const store = new MemoryStore()
const gateway = probeGateway(store, [])
const maxBytes = 1024 * 1024
const server = await createServer({
  configFile: false, envDir: false,
  define: { 'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify('sol-s03-local-fictitious-env'), 'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify('sol-s03-local-fictitious-key') },
  cacheDir: '/private/tmp/planner-sol-s03-vite',
  server: { host: '127.0.0.1', port: 4192, strictPort: true },
  plugins: [{
    name: 'sol-s03-local-gateway', enforce: 'pre',
    load(id) {
      if (id.split('?')[0].endsWith('/src/fusion/cloudClient.ts')) return `export async function connectGateway(){return async event=>{const response=await fetch('/__sol_s03_gateway',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});return response.json()}}`
    },
    configureServer(s) {
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
console.log('S03 local fictitious main flow: http://127.0.0.1:4192/fusion ; memory resets when process stops')
