// Test-only localhost preview of the real SDK; no seed/deployment/permission changes.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
const config = parseEnv(await readFile(process.argv[2], 'utf8'))
if (config.VITE_CLOUDBASE_ENV_ID !== 'dev-d1gh3jw1gdf06af22' || !config.VITE_CLOUDBASE_PUBLISHABLE_KEY) throw Error('INVALID_DEV_CONFIG')
const source = await readFile('src/fusion/cloudClient.ts', 'utf8')
const instrumented = source.replace('let connection:', 'let reviewAuth: any\nlet reviewLoss: string | null = null\nlet reviewLost = 0\nlet connection:')
  .replace("if ((await app.auth({ persistence: 'none' }).signInAnonymously()).error)", "reviewAuth = app.auth({ persistence: 'none' }); if ((await reviewAuth.signInAnonymously()).error)")
  .replace("return async (event: Record<string, unknown>) => (await app.callFunction({ name: import.meta.env.VITE_FUSION_FUNCTION || 'planner-fusion-gateway-probe', data: event })).result", "return async (event: Record<string, unknown>) => { const result = (await app.callFunction({ name: import.meta.env.VITE_FUSION_FUNCTION || 'planner-fusion-gateway-probe', data: event })).result; if (reviewLoss && event.action === 'execute' && (event.command as any)?.type === reviewLoss && result?.ok) { reviewLoss = null; reviewLost++; throw Error('INJECTED_CLIENT_LOST_RESPONSE') }; return result }")
  + '\nexport function reviewLoseNext(type: string) { if (!["version.restore", "access.rotateCollaboration"].includes(type)) throw Error("INVALID_REVIEW_FAULT"); reviewLoss = type }\nexport function reviewLossCount() { return reviewLost }\n'
  + '\nexport async function reviewIdentity() { await connectGateway(); return (await reviewAuth.getLoginState())?.user?.uid }\n'
const server = await createServer({ configFile: false, envDir: false,
  cacheDir: '/private/tmp/planner-main-flow-cloud-vite-4197', server: { host: '127.0.0.1', port: 4197, strictPort: true },
  define: { 'import.meta.env.VITE_FUSION_ENV_ID': JSON.stringify(config.VITE_CLOUDBASE_ENV_ID), 'import.meta.env.VITE_FUSION_PUBLISHABLE_KEY': JSON.stringify(config.VITE_CLOUDBASE_PUBLISHABLE_KEY) },
  plugins: [{ name: 'review-real-sdk-identity', enforce: 'pre', load(id) { if (id.split('?')[0].endsWith('/src/fusion/cloudClient.ts')) return instrumented } }, react(), tailwindcss()],
})
await server.listen()
console.log('Real dev SDK preview: http://127.0.0.1:4197/fusion; new fictitious projects only')
