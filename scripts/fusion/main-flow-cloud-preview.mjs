// Test-only localhost preview of the real SDK; no seed/deployment/permission changes.
import { build, preview } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
const config = parseEnv(await readFile(process.argv[2], 'utf8'))
if (config.VITE_CLOUDBASE_ENV_ID !== 'dev-d1gh3jw1gdf06af22' || !config.VITE_CLOUDBASE_PUBLISHABLE_KEY) throw Error('INVALID_DEV_CONFIG')
const source = await readFile('src/fusion/cloudClient.ts', 'utf8')
const instrumented = source.replace('let connection:', 'let reviewAuth: any\nlet reviewLoss: string | null = null\nlet reviewLost = 0\nlet connection:')
  .replace("if ((await app.auth({ persistence: 'none' }).signInAnonymously()).error)", "reviewAuth = app.auth({ persistence: 'none' }); if ((await reviewAuth.signInAnonymously()).error)")
  .replace("return async (event: Record<string, unknown>) => (await app.callFunction({ name: import.meta.env.VITE_FUSION_FUNCTION || 'planner-fusion-gateway-probe', data: event })).result", "return async (event: Record<string, unknown>) => { const result = (await app.callFunction({ name: import.meta.env.VITE_FUSION_FUNCTION || 'planner-fusion-gateway-probe', data: event })).result; if (reviewLoss && (event.action === 'project.create' ? 'project.create' : event.action === 'execute' ? (event.command as any)?.type : null) === reviewLoss && result?.ok) { reviewLoss = null; reviewLost++; throw Error('INJECTED_CLIENT_LOST_RESPONSE') }; return result }")
  + '\nexport function reviewLoseNext(type: string) { if (!["project.create", "version.restore", "access.rotateCollaboration"].includes(type)) throw Error("INVALID_REVIEW_FAULT"); reviewLoss = type }\nexport function reviewLossCount() { return reviewLost }\n'
  + '\nexport async function reviewIdentity() { await connectGateway(); return (await reviewAuth.getLoginState())?.user?.uid }\n'
const outDir = await mkdtemp(join(tmpdir(), 'planner-cloud-browser-build-'))
const options = { configFile: false, envDir: false,
  define: { 'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify(config.VITE_CLOUDBASE_ENV_ID), 'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify(config.VITE_CLOUDBASE_PUBLISHABLE_KEY) },
  build: { outDir, emptyOutDir: true },
  plugins: [{ name: 'review-real-sdk-identity', enforce: 'pre', load(id) { if (id.split('?')[0].endsWith('/src/fusion/cloudClient.ts')) return instrumented + '\nglobalThis.__fusionReview = { connectGateway, reviewLoseNext, reviewLossCount, reviewIdentity }\n' } }, react(), tailwindcss()],
}
// Production build avoids Vite dependency discovery reloading a pending form.
// The review adapter delegates to the very same app module; no second SDK client.
await build(options)
const server = await preview({ ...options, preview: { host: '127.0.0.1', port: 4197, strictPort: true }, plugins: [{ name: 'review-local-module', configurePreviewServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.split('?')[0] !== '/src/fusion/cloudClient.ts') return next()
    res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store')
    res.end('const review = globalThis.__fusionReview; if (!review) throw Error("REVIEW_APP_NOT_READY"); export const { connectGateway, reviewLoseNext, reviewLossCount, reviewIdentity } = review;')
  })
} }] })
console.log('Real dev SDK production preview: http://127.0.0.1:4197/fusion; new fictitious projects only')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.httpServer.close(); process.exit(0) })
