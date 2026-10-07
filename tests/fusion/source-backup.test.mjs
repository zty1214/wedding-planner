import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { collectPlannerBackup, collectSeatingBackup } from '../../scripts/migration/source-readers.mjs'
import { sealBackup, openBackup } from '../../scripts/migration/backup.mjs'
import { convertSeatingSource } from '../../scripts/migration/convert.mjs'
import { reconcileConversion } from '../../scripts/migration/reconcile.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
test('Planner adapter enforces explicit project, exact counts, stable order, capped pagination and never mutates', async () => {
  const calls = [], projectId = 'fictional-read-source'
  const rows = Object.fromEntries(['guests', 'tables', 'rooms', 'notes', 'project_config'].map(t => [t, t === 'guests' ? Array.from({ length: 505 }, (_, i) => ({ id: 'g' + String(i).padStart(3, '0'), project_id: projectId, name: '虚构' })) : []]))
  const client = { from: table => {
    const selection = { table }, query = { select(_fields, opts) { assert.equal(opts.count, 'exact'); return this },
      eq(field, id) { assert.equal(field, 'project_id'); selection.projectId = id; return this }, order(field) { selection.order = field; return this },
      range(offset, end) { selection.offset = offset; selection.end = end; return this }, abortSignal() { calls.push(selection); return Promise.resolve({ data: rows[table].slice(selection.offset, Math.min(selection.end + 1, selection.offset + 100)), count: rows[table].length, error: null }) } }
    return query
  } }
  const result = await collectPlannerBackup(client, projectId)
  assert.equal(result.manifest.collections.guests.count, 505); assert.deepEqual(calls.filter(c => c.table === 'guests').map(c => c.offset), [0, 100, 200, 300, 400, 500])
  assert.ok(calls.every(c => c.projectId === projectId && c.order === (c.table === 'project_config' ? 'project_id' : 'id')))
  assert.equal(result.manifest.consistency, 'preliminary'); assert.equal(JSON.parse(result.rawJson).guests.length, 505)
  rows.guests[0].project_id = 'other'; await assert.rejects(collectPlannerBackup(client, projectId), /SOURCE_PROJECT_SCOPE_MISMATCH/)
  await assert.rejects(collectPlannerBackup(client, ''), /EXPLICIT_SOURCE_PROJECT_REQUIRED/)
})
function seating() {
  const projectId = 'fictional-seating-source', row = { _id: projectId, projectId, schemaVersion: 1, updatedAt: 100,
    originalAttachment: 'https://fictional.invalid/source', wedding: { version: 1, title: '虚构婚礼', venueName: '虚构场地', updatedAt: 100, canvas: { width: 1000, height: 1800, entrance: { x: 500, y: 1600 } }, tables: {}, guests: {} } }
  const db = { collection(name) { assert.equal(name, 'weddings'); return { where(filter) { assert.deepEqual(filter, { _id: projectId, projectId }); return this }, limit(n) { assert.equal(n, 2); return this }, get: async () => ({ data: [row] }) } } }
  return { projectId, row, db }
}
test('Seating full document backup decrypts into conversion without stripping scope, timestamps or original unknown fields', async () => {
  const { projectId, row, db } = seating(), backup = await collectSeatingBackup(db, projectId), key = randomBytes(32)
  const restored = openBackup(sealBackup(backup.rawJson, backup.manifest, key), key)
  assert.deepEqual(JSON.parse(restored.rawJson).weddings[0], row)
  const layoutDecision = { sourceProjectId: projectId, sourceHash: restored.sourceHash, decisionId: 'fictional-decision', confirmedBy: 'fictional-user', confirmedAt: '2026-10-08T00:00:00Z', coordinateMode: 'preserve-seating-world', mainStagePos: null }
  const a = convertSeatingSource(restored.rawJson, { sourceProjectId: projectId, batchId: 'fictional-trial', layoutDecision })
  assert.equal(a.sourceHash, restored.sourceHash); assert.equal(a.sourceHash, sha(backup.rawJson)); assert.equal(reconcileConversion(a).passed, true)
  assert.equal(a.provenance.rawJson, backup.rawJson)
})
test('Seating adapters and converter reject wrong ownership, mismatched timestamps, missing and duplicate documents', async () => {
  for (const mutate of [r => { r.projectId = 'other' }, r => { r.updatedAt++ }, r => { r.schemaVersion = 2 }]) {
    const { projectId, row, db } = seating(); mutate(row)
    await assert.rejects(collectSeatingBackup(db, projectId), /SOURCE_PROJECT_OR_VERSION_MISMATCH/)
    assert.throws(() => convertSeatingSource(JSON.stringify({ weddings: [row] }), { sourceProjectId: projectId, batchId: 'trial' }), /SOURCE_PROJECT_OR_VERSION_MISMATCH/)
  }
  for (const data of [[], [seating().row, seating().row]]) {
    const { projectId } = seating(), db = { collection: () => ({ where() { return this }, limit() { return this }, get: async () => ({ data }) }) }
    await assert.rejects(collectSeatingBackup(db, projectId), /SOURCE_DOCUMENT_REQUIRED/)
  }
})

test('source backup CLI defaults to no network and rejects unsafe key/output before acquiring cloud credentials', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'planner-source-cli-test-'))
  try {
    const config = join(dir, 'config.json'), key = join(dir, 'key'), output = join(dir, 'backup.json')
    await writeFile(config, JSON.stringify({ environmentId: 'fictional-source-env', region: 'ap-shanghai' })); await writeFile(key, randomBytes(32), { mode: 0o600 }); await writeFile(output, 'existing')
    const run = extra => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/migration/source-backup-cli.mjs', '--source-system', 'cloudbase-wedding', '--project-id', 'fictional-project', '--source-config', config, ...extra], { encoding: 'utf8', env: { ...process.env, PATH: dir } })
    const dry = run([]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).mode, 'dry-run'); assert.ok(!dry.stdout.includes('fictional-project'))
    const existing = run(['--read-source', '--key-file', key, '--output', output]); assert.equal(existing.status, 1); assert.ok(existing.stderr.includes('OUTPUT_ALREADY_EXISTS'))
    const { chmod } = await import('node:fs/promises'); await chmod(key, 0o644)
    assert.ok(run(['--read-source', '--key-file', key, '--output', join(dir, 'new')]).stderr.includes('PRIVATE_KEY_PERMISSIONS_REQUIRED'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('actual Supabase client CLI encrypts a scoped localhost response and verifies the saved envelope without plaintext output', async () => {
  const { createServer } = await import('node:http'), { spawn } = await import('node:child_process'), { mkdtemp, writeFile, readFile, stat, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'planner-source-http-test-')), key = randomBytes(32), projectId = 'fictional-http-source'
  const source = { guests: [{ id: 'g', project_id: projectId, name: 'PRIVATE_FICTIONAL_GUEST', phone: '00123456789' }], tables: [], rooms: [], notes: [], project_config: [{ project_id: projectId, stay_dates: [] }] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'), table = url.pathname.split('/').pop()
    assert.equal(req.method, 'GET'); assert.equal(url.searchParams.get('project_id'), 'eq.' + projectId)
    const rows = source[table]; assert.ok(rows)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0' }); res.end(JSON.stringify(rows))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const config = join(dir, 'config.json'), keyPath = join(dir, 'key'), output = join(dir, 'backup.json')
    await writeFile(config, JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, anonKey: 'fictional-anon-key' })); await writeFile(keyPath, key, { mode: 0o600 })
    const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/migration/source-backup-cli.mjs', '--source-system', 'supabase-planner', '--project-id', projectId, '--source-config', config, '--key-file', keyPath, '--output', output, '--read-source'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; child.stdout.on('data', s => { stdout += s }); child.stderr.on('data', s => { stderr += s })
    const status = await new Promise(resolve => child.on('close', resolve)); assert.equal(status, 0, stderr)
    const encrypted = await readFile(output, 'utf8'), restored = openBackup(JSON.parse(encrypted), key)
    assert.deepEqual(JSON.parse(restored.rawJson), source); assert.equal(JSON.parse(stdout).status, 'verified')
    for (const secret of ['PRIVATE_FICTIONAL_GUEST', '00123456789', projectId, 'fictional-anon-key']) { assert.ok(!stdout.includes(secret)); assert.ok(!encrypted.includes(secret)) }
    assert.equal((await stat(output)).mode & 0o777, 0o600); assert.deepEqual((await readdir(dir)).sort(), ['backup.json', 'config.json', 'key'])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }) }
})
