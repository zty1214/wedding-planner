import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { emptyCore } from '../../src/fusion/core.ts'
import { documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { collectBackupSource, sealBackup } from '../../scripts/migration/backup.mjs'
import { planFusionRecovery, recoverFusionProject } from '../../scripts/migration/fusion-recovery.mjs'
const kinds = ['access', 'current', 'receipts', 'activity'], projectId = 'fusion-created-00000000-0000-4000-8000-000000000001'
const collections = Object.fromEntries(kinds.map(k => [k, 'planner_fusion_recovery_' + k]))
const target = { environmentId: 'fictional-recovery-env', sourceEnvironmentId: 'fictional-source-env', isolated: true, batchId: 'fictional-recovery' }
async function fixture(extra = 205) {
  const rootId = documentKey(projectId), epoch = 'original-epoch', core = emptyCore(), source = { access: [], current: [], receipts: [], activity: [] }
  source.access.push({ _id: rootId, projectId, payload: { managementHash: 'a'.repeat(64), collaborationHash: 'b'.repeat(64), revision: 3 } })
  source.current.push({ _id: rootId, projectId, payload: { dataEpoch: epoch, snapshotRevision: 7, data: core } },
    { _id: documentKey(projectId, 'notes', epoch), projectId, payload: { revision: 4, order: ['note-one'], retiredIds: ['old-note'] } },
    { _id: documentKey(projectId, 'note', epoch, 'note-one'), projectId, payload: { id: 'note-one', revision: 3, category: '虚构', title: '原题', content: '完整原文\n00123', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' } })
  for (let i = 0; i < extra; i++) source.receipts.push({ _id: documentKey(projectId, 'receipt', 'old-epoch', String(i)), projectId, payload: { digest: 'c'.repeat(64), originalOperation: i, unknownReceiptField: '完整保留' } })
  const collected = await collectBackupSource({ sourceSystem: 'fusion-project', sourceEnvironmentId: target.sourceEnvironmentId, sourceProjectId: projectId, schema: 'fusion-project-documents-v1', exportedAt: '2026-10-08T00:00:00Z', physicalCollections: collections }, kinds,
    async (kind, offset) => ({ count: source[kind].length, rows: source[kind].slice(offset, offset + 100) }))
  const key = randomBytes(32); return { source, key, envelope: sealBackup(collected.rawJson, collected.manifest, key) }
}
function memory() {
  let docs = Object.fromEntries(kinds.map(k => [k, new Map()])), tail = Promise.resolve()
  const control = { failId: null, documentWrites: 0, maximumOperations: 0 }
  const clone = value => structuredClone(value)
  return { environmentId: target.environmentId, collections, control, get docs() { return docs },
    async scan(project) { return Object.fromEntries(kinds.map(k => [k, [...docs[k].values()].filter(r => r.projectId === project).map(clone)])) },
    run(project, controlId, body) {
      const result = tail.then(async () => {
        const draft = clone(docs); let operations = 0
        const op = () => { operations++; assert.ok(operations <= 100, 'platform transaction limit exceeded') }
        const value = await body({ metadata: async () => { op(); return clone(draft.current.get(controlId)?.payload ?? null) },
          putMetadata: async v => { op(); draft.current.set(controlId, { _id: controlId, projectId: project, payload: clone(v) }) },
          get: async (kind, id) => { op(); return clone(draft[kind].get(id) ?? null) },
          put: async (kind, row) => { op(); if (control.failId === row._id) { control.failId = null; throw Error('SIMULATED_RECOVERY_FAILURE') }
            control.documentWrites++; draft[kind].set(row._id, clone(row)) },
        }); control.maximumOperations = Math.max(control.maximumOperations, operations); docs = draft; return value
      }); tail = result.catch(() => {}); return result
    },
  }
}
const run = (store, f, action, config = target) => recoverFusionProject(store, f.envelope, f.key, config, action)
test('whole-project encrypted recovery preserves permission/epoch/note/receipt fields across hundreds of documents with bounded transactions', async () => {
  const f = await fixture(), store = memory(), rootId = documentKey(projectId)
  const plan = await recoverFusionProject(null, f.envelope, f.key); assert.equal(plan.mode, 'offline-recovery-plan')
  for (const action of ['prepare', 'import', 'verify']) await run(store, f, action)
  assert.equal(store.docs.access.has(rootId), false); assert.equal(store.docs.current.has(rootId), false)
  const result = await run(store, f, 'publish'); assert.equal(result.state, 'published'); assert.ok(store.control.maximumOperations < 20)
  for (const kind of kinds) for (const row of f.source[kind]) assert.deepEqual(store.docs[kind].get(row._id), row)
  assert.equal(result.totalDocuments, 209); assert.ok(!JSON.stringify(result).includes('00123'))
  const writes = store.control.documentWrites
  await run(store, f, 'import'); await run(store, f, 'publish'); assert.equal(store.control.documentWrites, writes)
})
test('recovery interruption resumes without duplicates; incomplete or unverified copies never open', async () => {
  const f = await fixture(3), store = memory(); await run(store, f, 'prepare'); store.control.failId = f.source.receipts[1]._id
  await assert.rejects(run(store, f, 'import'), /SIMULATED_RECOVERY_FAILURE/)
  await assert.rejects(run(store, f, 'publish'), /RECOVERY_INCOMPLETE/)
  await run(store, f, 'import'); await assert.rejects(run(store, f, 'publish'), /RECOVERY_VERIFICATION_REQUIRED/)
  await run(store, f, 'verify'); await run(store, f, 'publish')
})
test('manual changes, extra target documents, foreign batches and same-environment restore are rejected without overwrite', async () => {
  const f = await fixture(2), store = memory(); await run(store, f, 'prepare'); await run(store, f, 'import'); await run(store, f, 'verify')
  const note = f.source.current[2]; store.docs.current.get(note._id).payload.content = '人工改动'
  await assert.rejects(run(store, f, 'publish'), /RECOVERY_READBACK_MISMATCH/); await assert.rejects(run(store, f, 'import'), /RECOVERY_TARGET_MODIFIED/)
  assert.equal(store.docs.current.get(note._id).payload.content, '人工改动')
  await assert.rejects(run(store, f, 'prepare', { ...target, batchId: 'other' }), /RECOVERY_TARGET_NOT_EMPTY/)
  await assert.rejects(run(store, f, 'prepare', { ...target, sourceEnvironmentId: target.environmentId }), /EXPLICIT_ISOLATED_RECOVERY_REQUIRED/)
  const fresh = memory(); await run(fresh, f, 'prepare'); await run(fresh, f, 'import')
  fresh.docs.activity.set('manual-extra', { _id: 'manual-extra', projectId, payload: { manual: true } })
  await assert.rejects(run(fresh, f, 'verify'), /RECOVERY_READBACK_MISMATCH/)
})
test('corrupt envelopes and structurally incomplete notes are refused before target writes', async () => {
  const f = await fixture(0); assert.throws(() => planFusionRecovery(f.envelope, randomBytes(32)), /BACKUP_AUTHENTICATION_FAILED/)
  const { openBackup } = await import('../../scripts/migration/backup.mjs'), payload = openBackup(f.envelope, f.key), source = JSON.parse(payload.rawJson)
  source.current = source.current.filter(r => r._id !== f.source.current[2]._id)
  const collected = await collectBackupSource(payload.manifest, kinds, async (kind, offset) => ({ rows: source[kind].slice(offset), count: source[kind].length }))
  assert.throws(() => planFusionRecovery(sealBackup(collected.rawJson, collected.manifest, f.key), f.key), /BACKUP_NOTE_REFERENCE_MISSING/)
})

test('recovery CLI authenticates private input first and requires explicit apply; default does not connect', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'planner-recovery-cli-test-')), f = await fixture(0)
  try {
    const input = join(dir, 'backup.json'), key = join(dir, 'key'), config = join(dir, 'target.json')
    await writeFile(input, JSON.stringify(f.envelope)); await writeFile(key, f.key, { mode: 0o600 }); await writeFile(config, JSON.stringify({ ...target, sourceEnvironmentId: target.environmentId }))
    const run = extra => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/migration/fusion-recovery-cli.mjs', '--input', input, '--key-file', key, ...extra], { encoding: 'utf8', env: { ...process.env, PATH: dir } })
    const dry = run([]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).mode, 'offline-recovery-plan')
    for (const secret of [projectId, '00123', '完整原文', 'a'.repeat(64)]) assert.ok(!dry.stdout.includes(secret))
    assert.ok(run(['--action', 'import']).stderr.includes('EXPLICIT_RECOVERY_APPLY_REQUIRED'))
    assert.ok(run(['--action', 'prepare', '--apply', '--target-config', config]).stderr.includes('EXPLICIT_ISOLATED_RECOVERY_REQUIRED'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
