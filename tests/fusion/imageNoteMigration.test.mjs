import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { convertPlannerSource } from '../../scripts/migration/convert.mjs'
import { reconcileConversion } from '../../scripts/migration/reconcile.mjs'
import { migrationBatch } from '../../scripts/migration/batch.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
const options = { sourceProjectId: 'fictional', batchId: 'image-gate' }
function raw(title = '虚构图片笔记', content = '   ', images = ['fictional://private-image']) {
  return JSON.stringify({ guests: [], tables: [], rooms: [], project_config: [{ project_id: 'fictional', stay_dates: [] }], notes: [{ id: 'note1', project_id: 'fictional', category: '备忘', title, content, images, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' }] })
}
function decision(source, action = 'exclude') { return { decisionId: 'decision-1', sourceProjectId: 'fictional', sourceHash: hash(source), noteId: 'note1', action,
  confirmedBy: 'fictional-reviewer', confirmedAt: '2026-10-08T00:00:00Z', reason: '虚构人工核对', ...(action === 'text' ? { content: '人工核对后的完整文字', title: '核对标题' } : {}) } }
test('all image-only notes require disposition; clearing converter flags cannot bypass independent reconciliation or publish', async () => {
  for (const title of ['有标题', '', '  ']) {
    const source = raw(title), artifact = convertPlannerSource(source, options)
    assert.equal(artifact.summary.readyForTrial, false)
    assert.ok(artifact.issues.some(issue => issue.code === 'PURE_IMAGE_NOTE_DECISION_REQUIRED'))
    artifact.issues = [] // A manipulated converter report must not defeat source readback.
    const report = reconcileConversion(artifact)
    assert.equal(report.passed, false)
    assert.ok(report.issues.some(issue => issue.code === 'PURE_IMAGE_NOTE_DECISION_REQUIRED'))
    let calls = 0
    await assert.rejects(migrationBatch({ run: async () => { calls++; throw Error('UNEXPECTED_WRITE') } }, artifact, {}, 'publish'), /CONVERSION_NOT_RECONCILED/)
    assert.equal(calls, 0)
  }
})
test('explicit exclusion is accounted separately and cannot be reported as fully retained migration', () => {
  const source = raw(''), artifact = convertPlannerSource(source, { ...options, noteDecisions: [decision(source)] })
  assert.equal(artifact.summary.readyForTrial, true); assert.equal(artifact.candidate.notes.length, 0)
  assert.equal(artifact.summary.excludedRecords, 1); assert.equal(artifact.summary.unresolvedRecords, 0)
  const report = reconcileConversion(artifact); assert.equal(report.passed, true); assert.equal(report.excludedRecords, 1)
  assert.equal(report.dispositionCoverage, 1); assert.ok(report.retainedCoverage < 1)
  assert.equal(artifact.provenance.rawJson, source)
})
test('text replacement is independently reconciled and source-bound decisions cannot move across source, project or note', () => {
  const source = raw(), good = decision(source, 'text')
  const artifact = convertPlannerSource(source, { ...options, noteDecisions: [good] })
  assert.equal(artifact.summary.readyForTrial, true); assert.equal(reconcileConversion(artifact).passed, true)
  assert.equal(artifact.candidate.notes[0].content, good.content)
  for (const patch of [{ sourceHash: '0'.repeat(64) }, { sourceProjectId: 'other' }, { noteId: 'other' }, { content: '  ' }, { confirmedBy: '' }]) {
    const bad = convertPlannerSource(source, { ...options, noteDecisions: [{ ...good, ...patch }] })
    assert.equal(bad.summary.readyForTrial, false); assert.equal(reconcileConversion(bad).passed, false)
  }
  const altered = structuredClone(artifact); altered.provenance.noteDecisions[0].reason = '更改处置记录'
  assert.equal(reconcileConversion(altered).passed, false)
  const target = structuredClone(artifact.candidate); target.notes[0].content = '错误正文'
  assert.equal(reconcileConversion(artifact, target).passed, false)
})
test('text plus attachments and plain text remain retained without a forced image disposition', () => {
  for (const images of [['fictional://image'], []]) {
    const artifact = convertPlannerSource(raw('标题', '完整正文', images), options)
    assert.equal(artifact.summary.readyForTrial, true); assert.equal(reconcileConversion(artifact).passed, true)
    assert.equal(artifact.candidate.notes[0].content, '完整正文')
  }
})
