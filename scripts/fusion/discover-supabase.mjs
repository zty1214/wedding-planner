import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { TABLES, readAllPages, inventory } from './inventory.mjs'

// Deliberately request project IDs only; no guest names, phones, notes or credentials in report.
import { readPlannerProject } from './read-project.mjs'

const [output, mode] = process.argv.slice(2)
if (!output) throw Error('Usage: node --env-file=.env.local scripts/fusion/discover-supabase.mjs <summary.json>')
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw Error('SUPABASE_CONFIGURATION_MISSING')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const projects = new Map(), projectIds = new Map(), tables = {}
for (const table of TABLES) {
  const rows = await readAllPages(async (offset, size) => {
    let query = client.from(table).select('project_id', { count: 'exact' }).order('project_id')
    if (table !== 'project_config') query = query.order('id')
    const { data, count, error } = await query.range(offset, offset + size - 1).abortSignal(AbortSignal.timeout(20_000))
    if (error) throw Error(`READ_FAILED:${table}:${error.code || 'TRANSPORT_ERROR'}`)
    return { rows: data, count }
  })
  tables[table] = rows.length
  for (const row of rows) {
    if (typeof row.project_id !== 'string' || !row.project_id) throw Error(`INVALID_PROJECT_ID:${table}`)
    const hash = createHash('sha256').update(row.project_id).digest('hex')
    const counts = projects.get(hash) ?? Object.fromEntries(TABLES.map(t => [t, 0]))
    counts[table]++
    projects.set(hash, counts)
    projectIds.set(hash, row.project_id)
  }
}
const details = []
if (mode === '--details') {
  for (const [projectHash, projectId] of projectIds) {
    const bundle = await readPlannerProject(client, projectId)
    details.push({ projectHash, ...inventory(bundle, projectId) })
  }
}
const report = { details, observedAt: new Date().toISOString(), sourceSystem: 'planner-supabase', tables,
  projects: [...projects].map(([projectHash, counts]) => ({ projectHash, counts })),
  consistency: 'READ_ONLY_DISCOVERY_NOT_FROZEN_EXPORT', identityAssignment: 'REQUIRES_OWNER_RECONCILIATION' }
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ projectCount: projects.size, tableRows: tables }))
