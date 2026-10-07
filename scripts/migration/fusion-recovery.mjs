// Whole-project disaster recovery into an empty isolated environment; never merges edits.
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../src/fusion/protocol.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'
import { acceptsBusinessProject } from '../../server/fusion/businessGateway.ts'
import { collectFusionBackup, validateFusionCollections } from './source-readers.mjs'
import { openBackup } from './backup.mjs'
const kinds = ['access', 'current', 'receipts', 'activity']
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex')
export function planFusionRecovery(envelope, key) {
  const backup = openBackup(envelope, key), source = JSON.parse(backup.rawJson), projectId = backup.manifest.sourceProjectId
  if (typeof backup.manifest.sourceEnvironmentId !== 'string' || !backup.manifest.sourceEnvironmentId || !acceptsBusinessProject(projectId) || backup.manifest.sourceSystem !== 'fusion-project' || kinds.some(k => !Array.isArray(source[k])) || Object.keys(source).length !== 4) throw Error('FUSION_BACKUP_REQUIRED')
  for (const kind of kinds) if (source[kind].some(r => r.projectId !== projectId || typeof r._id !== 'string')) throw Error('BACKUP_PROJECT_SCOPE_MISMATCH')
  const rootId = documentKey(projectId), access = source.access.find(r => r._id === rootId), current = source.current.find(r => r._id === rootId)
  if (!access || !current || !/^[a-f0-9]{64}$/.test(access.payload?.managementHash)
    || !/^[a-f0-9]{64}$/.test(access.payload?.collaborationHash) || access.payload.managementHash === access.payload.collaborationHash
    || typeof current.payload?.dataEpoch !== 'string' || !current.payload.dataEpoch
    || !Number.isSafeInteger(current.payload.snapshotRevision) || current.payload.snapshotRevision < 0) throw Error('BACKUP_ROOT_STATE_INVALID')
  assertCore(current.payload.data)
  const epoch = current.payload.dataEpoch, index = source.current.find(r => r._id === documentKey(projectId, 'notes', epoch))?.payload ?? { revision: 0, order: [] }
  if (!Number.isSafeInteger(index.revision) || index.revision < 0 || !Array.isArray(index.order) || index.order.some(id => typeof id !== 'string') || new Set(index.order).size !== index.order.length
    || (index.retiredIds !== undefined && (!Array.isArray(index.retiredIds) || index.retiredIds.some(id => typeof id !== 'string') || new Set(index.retiredIds).size !== index.retiredIds.length))) throw Error('BACKUP_NOTE_INDEX_INVALID')
  for (const id of index.order) {
    const note = source.current.find(r => r._id === documentKey(projectId, 'note', epoch, id))?.payload
    if (!note || note.id !== id) throw Error('BACKUP_NOTE_REFERENCE_MISSING')
    assertTextNote(note)
  }
  return { backup, source, projectId, rootId, access, current,
    summary: { mode: 'offline-recovery-plan', sourceHash: backup.sourceHash, consistency: backup.manifest.consistency,
      counts: Object.fromEntries(kinds.map(k => [k, source[k].length])) } }
}
export async function recoverFusionProject(store, envelope, key, target, action = 'dry-run') {
  const plan = planFusionRecovery(envelope, key)
  if (action === 'dry-run') return plan.summary
  if (!['prepare', 'import', 'verify', 'publish'].includes(action)) throw Error('INVALID_RECOVERY_ACTION')
  if (!target?.environmentId || target.sourceEnvironmentId !== plan.backup.manifest.sourceEnvironmentId || target.environmentId === target.sourceEnvironmentId
    || store.environmentId !== target.environmentId || target.isolated !== true || !target.batchId) throw Error('EXPLICIT_ISOLATED_RECOVERY_REQUIRED')
  const bindingHash = digest({ environmentId: target.environmentId, sourceEnvironmentId: target.sourceEnvironmentId, batchId: target.batchId,
    sourceHash: plan.backup.sourceHash, projectId: plan.projectId, collections: store.collections })
  const controlId = documentKey(plan.projectId, 'recovery-control', bindingHash)
  if (plan.source.current.some(r => r._id === controlId)) throw Error('RECOVERY_CONTROL_COLLISION')
  const rows = kinds.flatMap(kind => plan.source[kind].map(row => ({ kind, row, key: kind + ':' + row._id })))
  const staged = rows.filter(v => !(v.row._id === plan.rootId && ['access', 'current'].includes(v.kind)))
  const run = body => store.run(plan.projectId, controlId, body)
  const summary = meta => ({ mode: 'isolated-project-recovery', state: meta.state, sourceHash: plan.backup.sourceHash, bindingHash,
    completedDocuments: meta.completed.length, totalDocuments: rows.length, counts: plan.summary.counts })
  async function guard(tx, meta, subset = rows.filter(v => v.row._id === plan.rootId && ['access', 'current'].includes(v.kind))) {
    if (!meta || meta.bindingHash !== bindingHash) throw Error('RECOVERY_BINDING_MISMATCH')
    for (const v of subset) {
      const actual = await tx.get(v.kind, v.row._id)
      if (actual !== null && digest(actual) !== digest(v.row)) throw Error('RECOVERY_TARGET_MODIFIED')
      if (meta.completed.includes(v.key) && actual === null) throw Error('RECOVERY_TARGET_MISSING')
      if (meta.state !== 'published' && v.row._id === plan.rootId && ['access', 'current'].includes(v.kind) && actual !== null) throw Error('RECOVERY_TARGET_ALREADY_OPEN')
    }
  }
  if (action === 'prepare') {
    const scanned = await store.scan(plan.projectId)
    return run(async tx => {
      const old = await tx.metadata()
      if (old) { await guard(tx, old); return summary(old) }
      if (kinds.some(k => scanned[k].length)) throw Error('RECOVERY_TARGET_NOT_EMPTY')
      // Root gate is rechecked atomically; staged docs are checked individually before each write.
      if (await tx.get('access', plan.rootId) !== null || await tx.get('current', plan.rootId) !== null) throw Error('RECOVERY_TARGET_NOT_EMPTY')
      const meta = { bindingHash, state: 'prepared', completed: [] }; await tx.putMetadata(meta); return summary(meta)
    })
  }
  try {
    if (action === 'import') for (const v of staged) await run(async tx => {
      const meta = await tx.metadata(); await guard(tx, meta, [...rows.filter(v => v.row._id === plan.rootId && ['access', 'current'].includes(v.kind)), v])
      if (['verified', 'published'].includes(meta.state)) return
      if (!meta.completed.includes(v.key)) { await tx.put(v.kind, v.row); meta.completed.push(v.key) }
      meta.state = 'importing'; await tx.putMetadata(meta)
    })
    const scanned = action === 'verify' || action === 'publish' ? await store.scan(plan.projectId) : null
    return await run(async tx => {
      const meta = await tx.metadata(); await guard(tx, meta)
      if (action === 'import') return summary(meta)
      if (meta.state === 'published') {
        for (const kind of kinds) {
          const actual = scanned[kind].filter(r => !(kind === 'current' && r._id === controlId))
          const ordered = a => [...a].sort((x, y) => x._id < y._id ? -1 : x._id > y._id ? 1 : 0)
          if (digest(ordered(actual)) !== digest(ordered(plan.source[kind]))) throw Error('RECOVERY_TARGET_MODIFIED')
        }
        return summary(meta)
      }
      if (meta.completed.length !== staged.length) throw Error('RECOVERY_INCOMPLETE')
      for (const kind of kinds) {
        const actual = scanned[kind].filter(r => !(kind === 'current' && r._id === controlId)), expected = staged.filter(v => v.kind === kind).map(v => v.row)
        const ordered = rows => [...rows].sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
        if (digest(ordered(actual)) !== digest(ordered(expected))) throw Error('RECOVERY_READBACK_MISMATCH')
      }
      if (action === 'verify') meta.state = 'verified'
      else {
        if (meta.state !== 'verified') throw Error('RECOVERY_VERIFICATION_REQUIRED')
        await tx.put('current', plan.current); await tx.put('access', plan.access)
        meta.completed.push('current:' + plan.rootId, 'access:' + plan.rootId); meta.state = 'published'
      }
      await tx.putMetadata(meta); return summary(meta)
    })
  } catch (error) {
    try { await run(async tx => { const m = await tx.metadata(); if (m?.bindingHash === bindingHash && m.state !== 'published') {
      m.state = 'failed'; await tx.putMetadata(m)
    } }) } catch { /* retry will read actual committed state */ }
    throw Error(/^[A-Z_]+$/.test(error.message) ? error.message : 'RECOVERY_INTERRUPTED')
  }
}
export function cloudBaseRecoveryStore(db, collections) {
  validateFusionCollections(collections)
  const environmentId = db?.config?.envName
  if (typeof environmentId !== 'string' || !environmentId) throw Error('EXPLICIT_DATABASE_ENVIRONMENT_REQUIRED')
  return { environmentId, collections,
    async scan(projectId) { return JSON.parse((await collectFusionBackup(db, projectId, collections)).rawJson) },
    async run(projectId, controlId, body) {
      return db.runTransaction(async tx => {
        const ref = (kind, id) => tx.collection(collections[kind]).doc(id)
        const checked = r => { if (!r || r.code) throw Error('RECOVERY_DATABASE_FAILED'); return r }
        async function get(kind, id) {
          const doc = checked(await ref(kind, id).get()).data
          if (doc === null) return null
          if (doc.projectId !== projectId || doc._id !== id) throw Error('RECOVERY_DOCUMENT_SCOPE_MISMATCH')
          return doc
        }
        const put = async (kind, row) => { const { _id, ...value } = row; checked(await ref(kind, _id).set(value)) }
        return body({ get, put, metadata: async () => (await get('current', controlId))?.payload ?? null,
          putMetadata: v => put('current', { _id: controlId, projectId, payload: v }) })
      })
    },
  }
}
