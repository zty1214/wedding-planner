import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'node:fs/promises'
import { inventory } from './inventory.mjs'
import { readPlannerProject } from './read-project.mjs'

// No mutations or raw-data output. Never run against a guessed project ID.
const [projectId, output] = process.argv.slice(2)
if (!projectId || !output) throw Error('Usage: node --env-file=.env.local scripts/fusion/read-supabase.mjs <project-id> <summary.json>')
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw Error('SUPABASE_CONFIGURATION_MISSING')
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const bundle = await readPlannerProject(client, projectId)
await writeFile(output, JSON.stringify({ ...inventory(bundle, projectId), observedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log('Read-only inventory completed; no source rows written or exported.')
