// Offline dry-run only: no cloud import, no defaults pointing at production.
import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { controlledPath } from './privatePaths.mjs'
import { convertPlannerSource, convertSeatingSource } from './convert.mjs'
try {
  const { values } = parseArgs({ options: Object.fromEntries(['input', 'source-system', 'project-id', 'batch-id', 'config-file', 'output'].map(k => [k, { type: 'string' }])) })
  const raw = await readFile(await controlledPath(values.input), 'utf8')
  const config = values['config-file'] ? JSON.parse(await readFile(await controlledPath(values['config-file']), 'utf8')) : undefined
  const options = { sourceProjectId: values['project-id'], batchId: values['batch-id'] }
  let result
  if (values['source-system'] === 'supabase-planner') result = convertPlannerSource(raw, { ...options, localConfig: config })
  else if (values['source-system'] === 'cloudbase-wedding') result = convertSeatingSource(raw, { ...options, layoutDecision: config })
  else throw Error('EXPLICIT_SUPPORTED_SOURCE_REQUIRED')
  if (values.output) await writeFile(await controlledPath(values.output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ ...result.summary, sourceHash: result.sourceHash, targetHash: result.targetHash, mode: 'offline-dry-run' }))
  if (!result.summary.readyForTrial) process.exitCode = 2
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'CONVERSION_OPERATION_FAILED'
  console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1
}
