import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { convertPlannerSource, convertSeatingSource } from '../../scripts/migration/convert.mjs'
import { reconcileConversion } from '../../scripts/migration/reconcile.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const project_id = 'fictional-reconciliation', options = { sourceProjectId: project_id, batchId: 'fictional-batch' }
  const source = { project_config: [{ project_id, stay_dates: ['2026-12-31', '2027-01-01'] }],
    tables: [{ project_id, id: 't', label: '虚构桌', seats: 10, x: '123.5', y: '70', rotation: '45' }],
    rooms: [{ project_id, id: 'r', label: '001', type: '标间', notes: '虚构房备注' }],
    guests: [0, 1].map(i => ({ project_id, id: 'g' + i, name: '虚构同名', phone: '00123', group_name: '虚构分组', notes: '虚构备注', status: 'confirmed', table_id: 't', seat_index: i, room_id: 'r', stay_dates: [i ? '2027-01-01' : '2026-12-31'] })),
    notes: [{ project_id, id: 'n', category: '酒店', title: '虚构笔记', content: '完整正文\n' + '虚构内容'.repeat(100), images: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }] }
  return convertPlannerSource(JSON.stringify(source), options)
}
test('independent reconciliation covers every source row, fields, layout, full text and nightly occupancy with redacted report', () => {
  const a = fixture(), r = reconcileConversion(a)
  assert.equal(r.passed, true); assert.equal(r.dispositionCoverage, 1); assert.equal(r.sourceRecords, 6); assert.ok(r.checkedFields > 50)
  assert.deepEqual(r.nights, [{ date: '2026-12-31', guests: 1, rooms: 1 }, { date: '2027-01-01', guests: 1, rooms: 1 }])
  assert.deepEqual(r.roomArrangementNights, [{ date: '2026-12-31', arrangedPeople: 2, rooms: 1 }, { date: '2027-01-01', arrangedPeople: 2, rooms: 1 }])
  for (const text of ['虚构同名', '00123', '完整正文', a.sourceProjectId, a.batchId]) assert.ok(!JSON.stringify(r).includes(text))
})
test('equal aggregate counts cannot hide wrong phone, seat, notes, coordinates, dates, ordering or extra records', () => {
  const a = fixture()
  const mutations = [
    c => { c.data.guests[c.data.guestOrder[0]].phone = '123' },
    c => { [c.data.guests[c.data.guestOrder[0]].seatIndex, c.data.guests[c.data.guestOrder[1]].seatIndex] = [1, 0] },
    c => { c.notes[0].content = c.notes[0].content.slice(0, -1) },
    c => { c.data.tables[c.data.tableOrder[0]].x += 1 },
    c => { c.data.guests[c.data.guestOrder[0]].stayDates = ['2027-01-01'] },
    c => { c.data.guestOrder.reverse() },
    c => { c.data.config.title = '错误标题' },
    c => { c.notes.push({ ...c.notes[0], id: 'extra' }) },
  ]
  for (const mutate of mutations) {
    const actual = structuredClone(a.candidate); mutate(actual)
    const report = reconcileConversion(a, actual)
    assert.equal(report.passed, false); assert.ok(report.issues.some(i => i.code === 'FIELD_MISMATCH'))
  }
})
test('candidate artifact hashes and complete stable mapping are checked even if attacker recomputes target hash', () => {
  const a = fixture()
  for (const mutate of [c => { c.mapping.pop() }, c => { c.mapping[0].targetId = 'forged' }, c => { c.provenance.rawJson += ' ' }, c => { c.provenance.supplementalConfig = { title: 'forged' } }]) {
    const artifact = structuredClone(a); mutate(artifact); assert.equal(reconcileConversion(artifact).passed, false)
  }
  a.candidate.notes[0].content = '丢失原文'; a.targetHash = sha(JSON.stringify(a.candidate))
  assert.equal(reconcileConversion(a).passed, false)
})
test('Seating readback validates original state and source-bound layout decision; unresolved duplicates remain blocked', () => {
  const source = { version: 1, title: '虚构婚礼', canvas: { width: 1000, height: 2000 }, tables: { t: { id: 't', name: '虚构桌', capacity: 8, x: 123, y: 234 } },
    guests: { g: { id: 'g', name: '虚构人', relationshipGroup: '虚构组', phone: '00123', note: '备注', side: 'groom', attendance: 'declined', tableId: null, seatIndex: null } } }
  const raw = JSON.stringify(source), options = { sourceProjectId: 'fictional-source', batchId: 'fictional-batch', layoutDecision: { sourceProjectId: 'fictional-source', sourceHash: sha(raw), decisionId: 'fictional-decision', confirmedBy: 'fictional-user', confirmedAt: '2026-10-08T00:00:00Z', coordinateMode: 'preserve-seating-world', mainStagePos: null } }
  const a = convertSeatingSource(raw, options); assert.equal(reconcileConversion(a).passed, true)
  const actual = structuredClone(a.candidate); actual.data.guests[actual.data.guestOrder[0]].attendance = 'confirmed'
  assert.equal(reconcileConversion(a, actual).passed, false)
  const bad = fixture(), s = JSON.parse(bad.provenance.rawJson); s.guests.push({ ...s.guests[0] })
  const duplicate = convertPlannerSource(JSON.stringify(s), { sourceProjectId: bad.sourceProjectId, batchId: bad.batchId })
  assert.equal(reconcileConversion(duplicate).passed, false)
})
test('reconciliation CLI defaults to read-only and optional private output is exclusive', async () => {
  const { mkdtemp, writeFile, readFile, rm, stat } = await import('node:fs/promises'), { tmpdir } = await import('node:os')
  const { join } = await import('node:path'), { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'planner-reconciliation-test-'))
  try {
    const input = join(dir, 'candidate.json'), readback = join(dir, 'readback.json'), output = join(dir, 'report.json'), a = fixture()
    await writeFile(input, JSON.stringify(a)); await writeFile(readback, JSON.stringify(a.candidate))
    const run = extra => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/migration/reconcile-cli.mjs', '--input', input, '--readback', readback, ...extra], { encoding: 'utf8' })
    const dry = run([]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).passed, true); await assert.rejects(readFile(output), { code: 'ENOENT' })
    assert.equal(run(['--output', output]).status, 0); assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(run(['--output', output]).status, 1)
    a.candidate.notes[0].content = '截断'; await writeFile(readback, JSON.stringify(a.candidate)); assert.equal(run([]).status, 2)
    assert.equal(run(['--apply']).status, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('invalid date strings cannot leak personal data into reconciliation output', () => {
  const a = fixture(), actual = structuredClone(a.candidate)
  actual.data.config.stayDates = ['PRIVATE_PERSON_PHONE_00123']
  const report = reconcileConversion(a, actual)
  assert.equal(report.passed, false); assert.ok(!JSON.stringify(report).includes('PRIVATE_PERSON_PHONE_00123'))
})

test('missing cloud config requires explicit source-bound date-union decision and preserves guest dates', () => {
  const old = fixture(), source = JSON.parse(old.provenance.rawJson)
  source.project_config = []
  const raw = JSON.stringify(source), options = { sourceProjectId: old.sourceProjectId, batchId: old.batchId }
  assert.equal(convertPlannerSource(raw, options).summary.readyForTrial, false)
  const localConfig = { sourceProjectId: old.sourceProjectId, sourceHash: sha(raw), missingCloudConfig: 'guest-date-union' }
  const a = convertPlannerSource(raw, { ...options, localConfig })
  assert.equal(a.summary.readyForTrial, true)
  assert.equal(reconcileConversion(a).passed, true)
  assert.deepEqual(a.candidate.data.config.stayDates, [...new Set(source.guests.flatMap(g => g.stay_dates))].sort())
  assert.deepEqual(JSON.parse(a.provenance.rawJson).project_config, [])
  assert.equal(convertPlannerSource(raw, { ...options, localConfig: { ...localConfig, sourceHash: 'wrong' } }).summary.readyForTrial, false)
  const actual = structuredClone(a.candidate); actual.data.config.stayDates = []
  assert.equal(reconcileConversion(a, actual).passed, false)
  source.guests[0].stay_dates = ['invalid-date']
  const invalid = JSON.stringify(source)
  assert.equal(convertPlannerSource(invalid, { ...options, localConfig: { ...localConfig, sourceHash: sha(invalid) } }).summary.readyForTrial, false)
})
