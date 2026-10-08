// Local fictitious projects only. Separate ports prevent fixture shutdown races.
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenarios = ['accommodation', 'seating', 'drag-failure', 'history', 'editors', 'sharing', 'room-conflict', 'room-sort', 'room-recovery', 'room-date-conflict']
const basePort = Number(process.env.FEEDBACK_PORT_BASE ?? 4294)
if (!Number.isInteger(basePort) || basePort < 1024 || basePort + scenarios.length > 65535) throw Error('INVALID_FEEDBACK_PORT_BASE')
const output = process.env.FEEDBACK_OUTPUT ?? '/private/tmp/planner-feedback-results'
const report = { scope: 'local fictitious memory projects only; no cloud or real phone acceptance', node: process.version, scenarios: [] }
await mkdir(output, { recursive: true })
for (const [index, scenario] of scenarios.entries()) {
  console.log(`Running feedback scenario: ${scenario}`)
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`scripts/fusion/validate-feedback-${scenario}.mjs`], {
      cwd: root, env: { ...process.env, S03_PORT: String(basePort + index), FEEDBACK_OUTPUT: output }, stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1))
  })
  report.scenarios.push({ name: scenario, exitCode: code })
  await writeFile(join(output, 'feedback-suite-report.json'), JSON.stringify(report, null, 2) + '\n')
  if (code !== 0) { process.exitCode = code; break }
}
