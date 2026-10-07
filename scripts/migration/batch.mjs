// Operator-only trial migration. Not registered as a browser gateway operation.
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../src/fusion/protocol.ts'
import { acceptsBusinessProject } from '../../server/fusion/businessGateway.ts'
import { reconcileConversion } from './reconcile.mjs'
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex')
/** store.run must be serializable and roll back every write on failure.
 * Units: core and notes in the reserved epoch. Publish atomically installs access/current/index.
 */
export async function migrationBatch(store, artifact, target, action = 'dry-run') {
  const reconciliation = reconcileConversion(artifact)
  if (!reconciliation.passed) throw Error('CONVERSION_NOT_RECONCILED')
  // Full transactional readback is bounded by the platform's 100-operation limit.
  const withinTransactionBudget = artifact.candidate.notes.length <= 40
  if (action === 'dry-run') return { mode: 'dry-run', reconciliation, withinTransactionBudget, maximumNotes: 40 }
  if (!withinTransactionBudget) throw Error('MIGRATION_NOTE_TRANSACTION_LIMIT')
  if (!['prepare', 'import', 'verify', 'publish'].includes(action)) throw Error('INVALID_MIGRATION_ACTION')
  if (!target?.environmentId || !acceptsBusinessProject(target.projectId ?? '') || !target.sourceEnvironmentId || target.environmentId === target.sourceEnvironmentId
    || store.environmentId !== target.environmentId || target.isolated !== true || !target.access || !/^[a-f0-9]{64}$/.test(target.access.managementHash)
    || !/^[a-f0-9]{64}$/.test(target.access.collaborationHash) || target.access.managementHash === target.access.collaborationHash) throw Error('EXPLICIT_ISOLATED_TARGET_REQUIRED')
  const binding = { environmentId: target.environmentId, projectId: target.projectId, batchId: artifact.batchId,
    sourceSystem: artifact.sourceSystem, sourceProjectId: artifact.sourceProjectId, sourceHash: artifact.sourceHash,
    supplementalConfigHash: artifact.supplementalConfigHash, targetHash: artifact.targetHash, access: target.access }
  const bindingHash = digest(binding), epoch = 'migration_' + bindingHash, units = [['core', artifact.candidate.data], ...artifact.candidate.notes.map(n => [n.id, n])]
  const scoped = body => store.run(target.projectId, epoch, body)
  async function guard(tx, metadata) {
    if (!metadata || metadata.bindingHash !== bindingHash) throw Error('MIGRATION_BINDING_MISMATCH')
    const published = await tx.published()
    if (metadata.state === 'published') {
      if (!published || digest(published) !== digest({ dataEpoch: epoch, snapshotRevision: 0, data: artifact.candidate.data, access: target.access, notesOrder: artifact.candidate.notes.map(n => n.id) })) throw Error('TARGET_MODIFIED')
    } else if (published) throw Error('TARGET_NOT_EMPTY')
    for (const [key, value] of units) {
      const existing = await tx.unit(key)
      if (existing !== null && digest(existing) !== digest(value)) throw Error('TARGET_MODIFIED')
      if (metadata.completed.includes(key) && existing === null) throw Error('TARGET_UNIT_MISSING')
    }
  }
  const summary = metadata => ({ mode: 'trial-migration', state: metadata.state, completedUnits: metadata.completed.length,
    totalUnits: units.length, bindingHash, sourceHash: artifact.sourceHash, targetHash: artifact.targetHash })
  if (action === 'prepare') return scoped(async tx => {
    const old = await tx.metadata()
    if (old) { await guard(tx, old); return summary(old) }
    if (await tx.published()) throw Error('TARGET_NOT_EMPTY')
    for (const [key] of units) if (await tx.unit(key) !== null) throw Error('TARGET_NOT_EMPTY')
    const metadata = { bindingHash, state: 'prepared', completed: [], failureCode: null }
    await tx.putMetadata(metadata); return summary(metadata)
  })
  try {
    if (action === 'import') {
      for (const [key, value] of units) await scoped(async tx => {
        const metadata = await tx.metadata(); await guard(tx, metadata)
        if (['verified', 'published'].includes(metadata.state)) return
        if (!metadata.completed.includes(key)) {
          await tx.putUnit(key, value); metadata.completed.push(key)
        }
        metadata.state = 'importing'; metadata.failureCode = null; await tx.putMetadata(metadata)
      })
    }
    return await scoped(async tx => {
      const metadata = await tx.metadata(); await guard(tx, metadata)
      if (metadata.state === 'published') return summary(metadata)
      if (action === 'import') return summary(metadata)
      if (metadata.completed.length !== units.length) throw Error('INCOMPLETE_MIGRATION')
      const actual = { data: await tx.unit('core'), notes: [] }
      for (const n of artifact.candidate.notes) actual.notes.push(await tx.unit(n.id))
      const report = reconcileConversion(artifact, actual)
      if (!report.passed) throw Error('READBACK_RECONCILIATION_FAILED')
      if (action === 'verify') { metadata.state = 'verified'; metadata.failureCode = null }
      else {
        if (metadata.state !== 'verified') throw Error('VERIFIED_BATCH_REQUIRED')
        await tx.publish({ dataEpoch: epoch, snapshotRevision: 0, data: actual.data, access: target.access, notesOrder: actual.notes.map(n => n.id) })
        metadata.state = 'published'
      }
      await tx.putMetadata(metadata); return { ...summary(metadata), reconciliation: report }
    })
  } catch (error) {
    // Record a sanitized failure without overriding a foreign batch or completed publication.
    try { await scoped(async tx => {
      const metadata = await tx.metadata()
      if (metadata?.bindingHash === bindingHash && metadata.state !== 'published') {
        metadata.state = 'failed'; metadata.failureCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'MIGRATION_INTERRUPTED'
        await tx.putMetadata(metadata)
      }
    }) } catch { /* preserve original failure; retry will re-read committed units */ }
    throw Error(/^[A-Z_]+$/.test(error.message) ? error.message : 'MIGRATION_INTERRUPTED')
  }
}
