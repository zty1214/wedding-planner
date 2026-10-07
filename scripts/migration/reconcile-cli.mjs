import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { controlledPath } from './privatePaths.mjs'
import { reconcileConversion } from './reconcile.mjs'
try {
  const { values } = parseArgs({ options: Object.fromEntries(['input', 'readback', 'output'].map(k => [k, { type: 'string' }])) })
  const artifact = JSON.parse(await readFile(await controlledPath(values.input), 'utf8'))
  const actual = values.readback ? JSON.parse(await readFile(await controlledPath(values.readback), 'utf8')) : undefined
  const report = reconcileConversion(artifact, actual)
  if (values.output) await writeFile(await controlledPath(values.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 2
} catch { console.error(JSON.stringify({ status: 'failed', code: 'RECONCILIATION_FAILED' })); process.exitCode = 1 }
