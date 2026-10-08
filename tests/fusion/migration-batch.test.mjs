import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { convertPlannerSource } from '../../scripts/migration/convert.mjs'
import { migrationBatch } from '../../scripts/migration/batch.mjs'
import { cloudBaseMigrationStore } from '../../scripts/migration/cloudbase-batch-store.mjs'
import { documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
const target = { environmentId: 'fictional-preprod', sourceEnvironmentId: 'fictional-source', projectId: 'fusion-migrated-00000000-0000-4000-8000-000000000001', isolated: true,
  access: { managementHash: 'a'.repeat(64), collaborationHash: 'b'.repeat(64) } }
function artifact() {
  return convertPlannerSource(JSON.stringify({ guests: [], tables: [], rooms: [], project_config: [{ project_id: 'fictional', stay_dates: [] }],
    notes: [0, 1, 2].map(i => ({ project_id: 'fictional', id: 'n' + i, category: '虚构分类', title: '虚构标题', content: '完整正文' + i, images: [], created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' })) }), { sourceProjectId: 'fictional', batchId: 'fictional-batch' })
}
function memory() {
  const state = new Map(), control = { writes: 0, failUnit: null }
  let chain = Promise.resolve()
  return { environmentId: target.environmentId, state, control, run(project, epoch, body) {
    const next = chain.then(async () => {
      const snapshot = structuredClone(state.get(project) ?? { metadata: null, units: {}, published: null })
      const result = await body({ metadata: async () => structuredClone(snapshot.metadata), putMetadata: async v => { snapshot.metadata = structuredClone(v) },
        published: async () => structuredClone(snapshot.published), unit: async key => structuredClone(snapshot.units[epoch + ':' + key] ?? null),
        putUnit: async (key, value) => { if (control.failUnit === key) { control.failUnit = null; throw Error('SIMULATED_FAILURE') }
          control.writes++; snapshot.units[epoch + ':' + key] = structuredClone(value) },
        publish: async value => { snapshot.published = structuredClone(value) },
      }); state.set(project, snapshot); return result
    }); chain = next.catch(() => {}); return next
  } }
}
const run = (store, a, action) => migrationBatch(store, a, target, action)
test('dry-run never touches store; prepare/import/verify/publish keeps project unavailable until complete and is idempotent', async () => {
  const store = memory(), a = artifact()
  assert.equal((await migrationBatch({ run: () => { throw Error('UNEXPECTED_WRITE') } }, a)).mode, 'dry-run')
  assert.equal((await run(store, a, 'prepare')).state, 'prepared')
  assert.equal((await run(store, a, 'import')).completedUnits, 4); assert.equal(store.state.get(target.projectId).published, null)
  const writes = store.control.writes; await run(store, a, 'import'); assert.equal(store.control.writes, writes)
  assert.equal((await run(store, a, 'verify')).state, 'verified'); assert.equal(store.state.get(target.projectId).published, null)
  assert.equal((await run(store, a, 'publish')).state, 'published')
  await run(store, a, 'import'); await run(store, a, 'publish'); assert.equal(store.control.writes, writes)
  assert.equal(store.state.get(target.projectId).published.notesOrder.length, 3)
})
test('partial import resumes after failure and cannot publish before readback verification', async () => {
  const store = memory(), a = artifact(); await run(store, a, 'prepare'); store.control.failUnit = a.candidate.notes[1].id
  await assert.rejects(run(store, a, 'import'), /SIMULATED_FAILURE/)
  assert.equal(store.state.get(target.projectId).metadata.state, 'failed'); assert.equal(store.state.get(target.projectId).metadata.completed.length, 2)
  await assert.rejects(run(store, a, 'verify'), /INCOMPLETE_MIGRATION/)
  await run(store, a, 'import'); assert.equal(store.control.writes, 4)
  await assert.rejects(run(store, a, 'publish'), /VERIFIED_BATCH_REQUIRED/)
  await run(store, a, 'verify'); await run(store, a, 'publish')
})
test('manual edits before and after publication reject overwrite, including note body changes', async () => {
  for (const afterPublish of [false, true]) {
    const store = memory(), a = artifact(); await run(store, a, 'prepare'); await run(store, a, 'import')
    await run(store, a, 'verify'); if (afterPublish) await run(store, a, 'publish')
    const s = store.state.get(target.projectId), key = Object.keys(s.units).find(k => k.endsWith(a.candidate.notes[0].id))
    s.units[key].content = '人工修改'; const writes = store.control.writes
    await assert.rejects(run(store, a, 'import'), /TARGET_MODIFIED/); await assert.rejects(run(store, a, 'publish'), /TARGET_MODIFIED/)
    assert.equal(s.units[key].content, '人工修改'); assert.equal(store.control.writes, writes)
  }
  const store = memory(), a = artifact(); await run(store, a, 'prepare'); store.state.get(target.projectId).published = { data: 'existing-user-project' }
  await assert.rejects(run(store, a, 'import'), /TARGET_NOT_EMPTY/)
})
test('different source/batch/access hashes cannot reuse reservation; explicit separate actual DB environment is required', async () => {
  const store = memory(), a = artifact(); await run(store, a, 'prepare')
  for (const change of [v => { v.batchId += '-different'; v.mapping.forEach(m => { m.batchId = v.batchId }) }, v => { v.provenance.rawJson += ' ' }]) {
    const b = structuredClone(a); change(b)
    await assert.rejects(run(store, b, 'prepare'), /MIGRATION_BINDING_MISMATCH|CONVERSION_NOT_RECONCILED/)
  }
  await assert.rejects(migrationBatch(store, a, { ...target, access: { ...target.access, managementHash: 'c'.repeat(64) } }, 'prepare'), /MIGRATION_BINDING_MISMATCH/)
  await assert.rejects(migrationBatch(store, a, { ...target, sourceEnvironmentId: target.environmentId }, 'prepare'), /EXPLICIT_ISOLATED_TARGET_REQUIRED/)
  await assert.rejects(migrationBatch({ ...store, environmentId: 'wrong-actual-env' }, a, target, 'prepare'), /EXPLICIT_ISOLATED_TARGET_REQUIRED/)
})
test('concurrent same-batch retries stay idempotent and backup rebuild in a fresh target preserves all fields', async () => {
  const store = memory(), a = artifact(); await Promise.all([run(store, a, 'prepare'), run(store, a, 'prepare')])
  await Promise.all([run(store, a, 'import'), run(store, a, 'import')]); assert.equal(store.control.writes, 4)
  await run(store, a, 'verify'); await run(store, a, 'publish')
  const rebuilt = convertPlannerSource(a.provenance.rawJson, { sourceProjectId: a.sourceProjectId, batchId: 'recovery-batch' })
  const recovery = { ...target, projectId: 'fusion-migrated-00000000-0000-4000-8000-000000000002' }
  for (const action of ['prepare', 'import', 'verify', 'publish']) await migrationBatch(store, rebuilt, recovery, action)
  assert.deepEqual(store.state.get(target.projectId).published.data, store.state.get(recovery.projectId).published.data)
  assert.deepEqual(store.state.get(target.projectId).published.notesOrder, store.state.get(recovery.projectId).published.notesOrder)
})
test('CloudBase adapter uses gateway-compatible scoped document keys, sequential transactions and rollback on publication failure', async () => {
  let docs = new Map(), failAccess = false
  const db = { config: { envName: target.environmentId }, runTransaction: async body => {
    const draft = structuredClone(docs); let active = false
    const op = async body => { assert.equal(active, false); active = true; await Promise.resolve(); try { return body() } finally { active = false } }
    const result = await body({ collection: collection => ({ doc: id => ({
      get: () => op(() => ({ data: structuredClone(draft.get(collection + ':' + id) ?? null) })),
      set: value => op(() => { if (failAccess && collection === 'fictional_access') throw Error('SIMULATED_PUBLICATION_FAILURE')
        draft.set(collection + ':' + id, structuredClone(value)); return {} }),
    }) }) }); docs = draft; return result
  } }
  const collections = { access: 'fictional_access', current: 'fictional_current' }, store = cloudBaseMigrationStore(db, collections), a = artifact()
  for (const action of ['prepare', 'import', 'verify']) await run(store, a, action)
  failAccess = true; await assert.rejects(run(store, a, 'publish'), /SIMULATED_PUBLICATION_FAILURE/)
  assert.equal(docs.has(collections.current + ':' + documentKey(target.projectId)), false)
  assert.equal(docs.has(collections.access + ':' + documentKey(target.projectId)), false)
  failAccess = false; await run(store, a, 'verify'); await run(store, a, 'publish')
  const current = docs.get(collections.current + ':' + documentKey(target.projectId)).payload
  assert.deepEqual(current.data, a.candidate.data)
  const note = docs.get(collections.current + ':' + documentKey(target.projectId, 'note', current.dataEpoch, a.candidate.notes[0].id)).payload
  assert.deepEqual(note, a.candidate.notes[0])
  assert.throws(() => cloudBaseMigrationStore({ config: {} }, collections), /EXPLICIT_DATABASE_ENVIRONMENT_REQUIRED/)
})

test('batch CLI requires explicit action, apply and isolated target; default does not acquire credentials', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'planner-batch-cli-test-'))
  try {
    const input = join(dir, 'candidate.json'), config = join(dir, 'target.json')
    await writeFile(input, JSON.stringify(artifact())); await writeFile(config, JSON.stringify({ ...target, sourceEnvironmentId: target.environmentId, collections: { access: 'a', current: 'b' } }))
    const run = extra => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/migration/batch-cli.mjs', '--input', input, ...extra], { encoding: 'utf8', env: { ...process.env, PATH: dir } })
    const dry = run([]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).mode, 'dry-run')
    const noApply = run(['--action', 'import']); assert.equal(noApply.status, 1); assert.ok(noApply.stderr.includes('EXPLICIT_APPLY_AND_TARGET_REQUIRED'))
    const sameEnv = run(['--action', 'prepare', '--apply', '--target-config', config]); assert.equal(sameEnv.status, 1); assert.ok(sameEnv.stderr.includes('EXPLICIT_ISOLATED_TARGET_REQUIRED'))
    assert.equal(run(['--apply']).status, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('two hundred notes migrate completely with fewer than twenty operations in every adapter transaction', async () => {
  const source = JSON.parse(artifact().provenance.rawJson); source.notes = Array.from({ length: 200 }, (_, i) => ({ ...source.notes[0], id: 'bounded-note-' + i }))
  const a = convertPlannerSource(JSON.stringify(source), { sourceProjectId: 'fictional', batchId: 'bounded-batch' })
  let docs = new Map(), maximum = 0
  const db = { config: { envName: target.environmentId }, async runTransaction(body) {
    const draft = structuredClone(docs); let count = 0
    const op = () => { count++; assert.ok(count <= 100) }
    const result = await body({ collection: kind => ({ doc: id => ({ get: async () => { op(); return { data: structuredClone(draft.get(kind + ':' + id) ?? null) } },
      set: async v => { op(); draft.set(kind + ':' + id, structuredClone(v)); return {} } }) }) })
    maximum = Math.max(maximum, count); docs = draft; return result
  } }
  const store = cloudBaseMigrationStore(db, { access: 'fictional_access', current: 'fictional_current' })
  for (const action of ['prepare', 'import', 'verify', 'publish']) await run(store, a, action)
  assert.ok(maximum < 20);
  const root = docs.get('fictional_current:' + documentKey(target.projectId)).payload
  const index = docs.get('fictional_current:' + documentKey(target.projectId, 'notes', root.dataEpoch)).payload
  assert.equal(index.order.length, 200)
  for (const note of a.candidate.notes) assert.deepEqual(docs.get('fictional_current:' + documentKey(target.projectId, 'note', root.dataEpoch, note.id)).payload, note)
  assert.equal((await migrationBatch(null, a)).totalUnits, 201)
})

test('large trial interrupted near the end resumes without opening an incomplete project or duplicating notes', async () => {
  const source = JSON.parse(artifact().provenance.rawJson)
  source.notes = Array.from({ length: 150 }, (_, i) => ({ ...source.notes[0], id: 'resume-note-' + i, content: '完整正文' + i }))
  const a = convertPlannerSource(JSON.stringify(source), { sourceProjectId: 'fictional', batchId: 'large-resume-batch' }), store = memory()
  await run(store, a, 'prepare'); store.control.failUnit = a.candidate.notes[140].id
  await assert.rejects(run(store, a, 'import'), /SIMULATED_FAILURE/)
  assert.equal(store.state.get(target.projectId).published, null)
  assert.equal(store.state.get(target.projectId).metadata.completed.length, 141)
  await assert.rejects(run(store, a, 'publish'), /INCOMPLETE_MIGRATION/)
  await run(store, a, 'import'); assert.equal(store.control.writes, 151)
  await run(store, a, 'verify'); await run(store, a, 'publish')
  assert.equal(store.state.get(target.projectId).published.notesOrder.length, 150)
  await run(store, a, 'import'); assert.equal(store.control.writes, 151)
})


test('explicit image-note exclusion publishes an accounted partial content migration and binds its decision hash', async () => {
  const source = JSON.parse(artifact().provenance.rawJson)
  source.notes[0].content = ' '; source.notes[0].images = ['fictional://image']
  const raw = JSON.stringify(source), decision = { decisionId: 'exclude-1', sourceProjectId: 'fictional', sourceHash: createHash('sha256').update(raw).digest('hex'), noteId: 'n0', action: 'exclude', confirmedBy: 'fictional-reviewer', confirmedAt: '2026-10-08T00:00:00Z', reason: '已核对的虚构排除' }
  const a = convertPlannerSource(raw, { sourceProjectId: 'fictional', batchId: 'image-batch', noteDecisions: [decision] }), store = memory()
  await run(store, a, 'prepare')
  const changed = convertPlannerSource(raw, { sourceProjectId: 'fictional', batchId: 'image-batch', noteDecisions: [{ ...decision, reason: '处置被修改' }] })
  await assert.rejects(run(store, changed, 'import'), /MIGRATION_BINDING_MISMATCH/)
  await run(store, a, 'import'); await run(store, a, 'verify'); const published = await run(store, a, 'publish')
  assert.equal(published.reconciliation.excludedRecords, 1); assert.ok(published.reconciliation.retainedCoverage < 1)
  assert.equal(store.state.get(target.projectId).published.notesOrder.length, 2)
})
