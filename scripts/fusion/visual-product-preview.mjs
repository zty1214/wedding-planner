// Explicit localhost preview of current production build; reuses a fictitious
// project from an existing local demo without printing or persisting its link.
import { build, preview } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
const [configPath, portText] = process.argv.slice(2)
const port = Number(portText)
if (!configPath || !Number.isSafeInteger(port) || port < 4201 || port > 4299) throw Error('LOCAL_PREVIEW_ARGUMENTS_REQUIRED')
const config = parseEnv(await readFile(configPath, 'utf8'))
if (config.VITE_CLOUDBASE_ENV_ID !== 'dev-d1gh3jw1gdf06af22') throw Error('DEV_CONFIG_REQUIRED')
const response = await fetch('http://127.0.0.1:4200/demo', { redirect: 'manual' })
const location = response.headers.get('location')
if (response.status !== 302 || !location?.startsWith('/fusion/p/fusion-created-')) throw Error('FICTITIOUS_LOCAL_DEMO_REQUIRED')
const outDir = await mkdtemp(join(tmpdir(), 'planner-visual-product-'))
const options = { configFile: false, envDir: false, plugins: [react(), tailwindcss()], define: {
  'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify(config.VITE_CLOUDBASE_ENV_ID),
  'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify(config.VITE_CLOUDBASE_PUBLISHABLE_KEY),
}, build: { outDir, emptyOutDir: true } }
await build(options)
const server = await preview({ ...options, preview: { host: '127.0.0.1', port, strictPort: true }, plugins: [{ name: 'fictitious-demo-entry', configurePreviewServer(server) { server.middlewares.use((req, res, next) => {
  if (req.url !== '/demo') return next()
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end()
}) } }] })
console.log(`Current production preview: http://127.0.0.1:${port}/demo (fictitious data only)`)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.httpServer.close(); process.exit(0) })
