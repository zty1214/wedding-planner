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
  if (action === 'dry-run') return { mode: 'dry-run', reconciliation, transactionMode: 'bounded-units-closed-target', totalUnits: artifact.candidate.notes.length + 1 }
  if (!['prepare', 'import', 'verify', 'publish'].includes(action)) throw Error('INVALID_MIGRATION_ACTION')
  if (!target?.environmentId || !acceptsBusinessProject(target.projectId ?? '') || !target.sourceEnvironmentId || target.environmentId === target.sourceEnvironmentId
    || store.environmentId !== target.environmentId || target.isolated !== true || !target.access || !/^[a-f0-9]{64}$/.test(target.access.managementHash)
    || !/^[a-f0-9]{64}$/.test(target.access.collaborationHash) || target.access.managementHash === target.access.collaborationHash) throw Error('EXPLICIT_ISOLATED_TARGET_REQUIRED')
  const binding = { environmentId: target.environmentId, projectId: target.projectId, batchId: artifact.batchId,
    sourceSystem: artifact.sourceSystem, sourceProjectId: artifact.sourceProjectId, sourceHash: artifact.sourceHash,
    supplementalConfigHash: artifact.supplementalConfigHash, targetHash: artifact.targetHash, access: target.access }
  const bindingHash = digest(binding), epoch = 'migration_' + bindingHash, units = [['core', artifact.candidate.data], ...artifact.candidate.notes.map(n => [n.id, n])]
  const scoped = body => store.run(target.projectId, epoch, body)
  async function guard(tx, metadata, selected = []) {
    if (!metadata || metadata.bindingHash !== bindingHash) throw Error('MIGRATION_BINDING_MISMATCH')
    const published = await tx.published()
    if (metadata.state === 'published') {
      if (!published || digest(published) !== digest({ dataEpoch: epoch, snapshotRevision: 0, data: artifact.candidate.data, access: target.access, notesOrder: artifact.candidate.notes.map(n => n.id) })) throw Error('TARGET_MODIFIED')
    } else if (published) throw Error('TARGET_NOT_EMPTY')
    for (const [key, value] of selected) {
      const existing = await tx.unit(key)
      if (existing !== null && digest(existing) !== digest(value)) throw Error('TARGET_MODIFIED')
      if (metadata.completed.includes(key) && existing === null) throw Error('TARGET_UNIT_MISSING')
      if (!metadata.completed.includes(key) && existing !== null) throw Error('TARGET_NOT_EMPTY')
    }
  }
  const summary = metadata => ({ mode: 'trial-migration', state: metadata.state, completedUnits: metadata.completed.length,
    totalUnits: units.length, bindingHash, sourceHash: artifact.sourceHash, targetHash: artifact.targetHash })
  // No browser ACL exists while staging. Operators must exclude concurrent direct
  // administrative writes, as with isolated disaster recovery. Each transaction
  // rechecks the reservation and publication roots; all units are read back.
  async function inspect() {
    const actual = { data: null, notes: [] }
    for (const [key, value] of units) {
      const existing = await scoped(async tx => {
        const metadata = await tx.metadata(); await guard(tx, metadata, [[key, value]])
        return tx.unit(key)
      })
      if (key === 'core') actual.data = existing
      else if (existing !== null) actual.notes.push(existing)
    }
    return actual
  }
  try {
    if (action === 'prepare') {
      await scoped(async tx => {
        const old = await tx.metadata()
        if (old) { await guard(tx, old); return }
        if (await tx.published() || await tx.unit('core') !== null) throw Error('TARGET_NOT_EMPTY')
        await tx.putMetadata({ bindingHash, state: 'prepared', completed: [], failureCode: null })
      })
      await inspect()
      return scoped(async tx => { const metadata = await tx.metadata(); await guard(tx, metadata); return summary(metadata) })
    }
    if (action === 'import') {
      // Check the complete existing target before writing any new unit.
      await inspect()
      for (const [key, value] of units) await scoped(async tx => {
        const metadata = await tx.metadata(); await guard(tx, metadata, [[key, value]])
        if (['verified', 'published'].includes(metadata.state)) return
        if (!metadata.completed.includes(key)) {
          await tx.putUnit(key, value); metadata.completed.push(key)
        }
        metadata.state = 'importing'; metadata.failureCode = null; await tx.putMetadata(metadata)
      })
      return scoped(async tx => { const metadata = await tx.metadata(); await guard(tx, metadata); return summary(metadata) })
    }
    const before = await scoped(async tx => {
      const metadata = await tx.metadata(); await guard(tx, metadata)
      if (metadata.completed.length !== units.length) throw Error('INCOMPLETE_MIGRATION')
      return metadata
    })
    const actual = await inspect(), report = reconcileConversion(artifact, actual)
    if (!report.passed) throw Error('READBACK_RECONCILIATION_FAILED')
    return await scoped(async tx => {
      const metadata = await tx.metadata(); await guard(tx, metadata)
      if (digest(metadata) !== digest(before)) throw Error('MIGRATION_STATE_CHANGED')
      if (metadata.state === 'published') return { ...summary(metadata), reconciliation: report }
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
