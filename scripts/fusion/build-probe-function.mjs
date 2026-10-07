import { build } from 'rolldown'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { developmentCreationDailyLimit } from '../../server/fusion/projectService.ts'

// Fresh staging directory: never upload the repository, environment files, or CLI credentials.
const [directory, mode] = process.argv.slice(2)
if (mode !== undefined && mode !== '--daily') throw Error('Unknown build mode')
const functionName = mode === '--daily' ? 'planner-fusion-daily-probe' : 'planner-fusion-gateway-probe'
if (!directory) throw Error('Provide a new deployment directory')
const creationDailyLimit = mode === '--daily' ? undefined : developmentCreationDailyLimit(process.env.FUSION_DEV_CREATION_DAILY_LIMIT)
const root = resolve(directory)
await mkdir(root, { recursive: false })
await mkdir(resolve(root, 'functions', functionName), { recursive: true })
const projects = [0, 1].map(() => `fusion-gateway-${randomUUID()}`)
const filename = resolve(root, 'functions', functionName, 'index.js')
await build({ input: mode === '--daily' ? 'server/fusion/dailyFunction.ts' : 'server/fusion/probeFunction.ts', platform: 'node',
  output: { file: filename, format: 'cjs', sourcemap: false },
})
await writeFile(resolve(root, 'cloudbaserc.json'), JSON.stringify({
  envId: 'dev-d1gh3jw1gdf06af22', functionRoot: './functions',
  functions: [{ name: functionName, handler: 'index.main', runtime: 'Nodejs20.19',
    timeout: mode === '--daily' ? 60 : 20, memorySize: 256, installDependency: false,
    envVariables: { ...(creationDailyLimit === undefined ? {} : { FUSION_DEV_CREATION_DAILY_LIMIT: String(creationDailyLimit) }), FUSION_PROBE_ENV: 'dev-d1gh3jw1gdf06af22', FUSION_PROBE_PROJECTS: projects.join(','),
      LOG_EVENT_CONTEXT: 'false', LOG_HEADER_BODY: 'false', LOG_CONTENT_ENABLED: 'false' },
  }],
}, null, 2))
const manifest = { env: 'dev-d1gh3jw1gdf06af22', functionName,
  projects, ...(creationDailyLimit === undefined ? {} : { creationDailyLimit }), sha256: createHash('sha256').update(await readFile(filename)).digest('hex'),
  sdk: JSON.parse(await readFile('node_modules/@cloudbase/node-sdk/package.json', 'utf8')).version }
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ directory: root, ...manifest }))
