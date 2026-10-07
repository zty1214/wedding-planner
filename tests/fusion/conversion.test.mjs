import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPlannerSource, convertSeatingSource, stableMigrationId } from '../../scripts/migration/convert.mjs'
const options = { sourceProjectId: 'fictional-project', batchId: 'trial-one' }
function planner() {
  const p = 'fictional-project'
  return { tables: [{ id: 't', project_id: p, label: '原桌名', x: '12.5', y: '44', rotation: '30', seats: 8 }], rooms: [{ id: 'r', project_id: p, label: '001', type: '标间', notes: '原备注' }],
    guests: [{ id: 'g', project_id: p, name: '虚构小明', group_name: '原分组', phone: '00123456789', notes: '原文', status: 'assigned', table_id: 't', seat_index: 0, room_id: 'r', stay_dates: ['2026-12-31'] }, { id: 'g2', project_id: p, name: '虚构小明 2', group_name: '原分组', phone: '00123456789', status: 'confirmed', table_id: 't', seat_index: 1, room_id: 'r', stay_dates: ['2027-01-01'] }],
    notes: [{ id: 'n', project_id: p, category: '酒店', title: '', content: '完整\n正文', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', images: ['https://fictional.invalid/old'] }], project_config: [{ project_id: p, stay_dates: ['2026-12-31', '2027-01-01'] }] }
}
test('Planner conversion preserves references, zeroes, different nights, raw text and original layout without inferring attendance from seats', () => {
  const raw = JSON.stringify(planner()), result = convertPlannerSource(raw, options), data = result.candidate.data
  assert.equal(result.summary.readyForTrial, true)
  assert.equal(data.guests[data.guestOrder[0]].attendance, 'pending')
  assert.equal(data.guests[data.guestOrder[1]].attendance, 'confirmed')
  assert.equal(data.guests[data.guestOrder[0]].phone, '00123456789')
  assert.deepEqual(data.guestOrder.map(id => data.guests[id].stayDates), [['2026-12-31'], ['2027-01-01']])
  assert.equal(data.guests[data.guestOrder[0]].tableId, data.tableOrder[0]); assert.equal(data.guests[data.guestOrder[1]].seatIndex, 1)
  assert.deepEqual([data.tables[data.tableOrder[0]].x, data.tables[data.tableOrder[0]].y, data.tables[data.tableOrder[0]].rotation], [12.5, 44, 30])
  assert.equal(data.rooms[data.roomOrder[0]].label, '001'); assert.equal(result.candidate.notes[0].content, '完整\n正文')
  assert.equal(result.provenance.rawJson, raw); assert.equal(result.summary.sourceRecords, 6); assert.equal(result.summary.unresolvedRecords, 0)
  for (const secret of ['虚构小明', '00123456789', '完整', 'fictional.invalid']) assert.ok(!JSON.stringify(result.summary).includes(secret))
})
test('stable namespace IDs survive repeat batches and never merge same people or cross-project/source IDs', () => {
  const raw = JSON.stringify(planner()), a = convertPlannerSource(raw, options), b = convertPlannerSource(raw, { ...options, batchId: 'trial-two' })
  assert.deepEqual(a.candidate, b.candidate); assert.equal(a.targetHash, b.targetHash)
  assert.notEqual(stableMigrationId('supabase-planner', 'p', 'guests', 'g'), stableMigrationId('cloudbase-wedding', 'p', 'guests', 'g'))
  assert.notEqual(stableMigrationId('supabase-planner', 'p', 'guests', 'g'), stableMigrationId('supabase-planner', 'p2', 'guests', 'g'))
  assert.equal(a.candidate.data.guestOrder.length, 2)
})
test('invalid references, duplicate seats, source ownership and unknown attendance block trial without dropping source rows', () => {
  const source = planner(); Object.assign(source.guests[1], { project_id: 'other', status: 'unknown', seat_index: 0, room_id: 'missing' })
  const r = convertPlannerSource(JSON.stringify(source), options)
  assert.equal(r.summary.readyForTrial, false)
  for (const code of ['PROJECT_MISMATCH', 'UNKNOWN_ATTENDANCE', 'DUPLICATE_SEAT', 'MISSING_ROOM_REFERENCE']) assert.ok(r.issues.some(i => i.code === code))
  assert.equal(r.summary.sourceRecords, 6); assert.deepEqual(JSON.parse(r.provenance.rawJson), source)
})
test('duplicate source ID is unresolved rather than silently overwriting a guest; numeric telephone is not stringified', () => {
  const source = planner(); source.guests.push({ ...source.guests[0], name: '重复ID原文' }); source.guests[0].phone = 123
  const r = convertPlannerSource(JSON.stringify(source), options)
  assert.equal(r.summary.readyForTrial, false); assert.equal(r.summary.unresolvedRecords, 1)
  assert.equal(r.candidate.data.guests[r.candidate.data.guestOrder[0]].phone, 123)
  assert.equal(JSON.parse(r.provenance.rawJson).guests.length, 3)
})
test('reconciled browser config is scoped to its source project and no dates are invented', () => {
  const raw = JSON.stringify(planner())
  const c = { sourceProjectId: options.sourceProjectId, title: '已核对标题', mainStagePos: { x: 50, y: 30 }, customGroups: ['本地分组'] }
  const r = convertPlannerSource(raw, { ...options, localConfig: c })
  assert.equal(r.candidate.data.config.title, c.title); assert.deepEqual(r.candidate.data.config.mainStagePos, c.mainStagePos)
  assert.ok(r.candidate.data.config.customGroups.includes('本地分组'))
  assert.equal(convertPlannerSource(raw, { ...options, localConfig: { ...c, sourceProjectId: 'other' } }).summary.readyForTrial, false)
})
test('Seating uses a dedicated mapping, preserves explicit side/attendance and requires a source-bound layout decision', () => {
  const source = { version: 1, title: '虚构来源婚礼', canvas: { width: 1200, height: 1800, stage: { x: 600, y: 100 }, entrance: { x: 600, y: 1600 } }, updatedAt: 100,
    tables: { t: { id: 't', name: '来源桌名', capacity: 10, x: 350, y: 360, revision: 12 } }, guests: { g: { id: 'g', name: '来源宾客', relationshipGroup: '旧分组', phone: '00123', note: '旧备注', side: 'bride', attendance: 'pending', tableId: 't', seatIndex: 0, revision: 7 } } }
  const raw = JSON.stringify(source), pending = convertSeatingSource(raw, options)
  assert.equal(pending.summary.readyForTrial, false); assert.ok(pending.issues.some(i => i.code === 'LAYOUT_DECISION_REQUIRED'))
  const decision = { sourceProjectId: options.sourceProjectId, sourceHash: pending.sourceHash, decisionId: 'fictional-decision', confirmedBy: 'fictional-owner', confirmedAt: '2026-10-08T00:00:00Z', coordinateMode: 'preserve-seating-world', mainStagePos: { x: 522, y: 90 } }
  const r = convertSeatingSource(raw, { ...options, layoutDecision: decision }), data = r.candidate.data
  assert.equal(r.summary.readyForTrial, true); assert.equal(data.guests[data.guestOrder[0]].side, 'bride'); assert.equal(data.guests[data.guestOrder[0]].attendance, 'pending')
  assert.equal(data.tables[data.tableOrder[0]].seats, 10); assert.equal(data.tables[data.tableOrder[0]].revision, 0)
  assert.equal(r.provenance.rawJson, raw)
  assert.equal(convertSeatingSource(raw.replace('旧备注', '不同原文'), { ...options, layoutDecision: decision }).summary.readyForTrial, false)
})
test('local date disagreement is explicit and supplemental source config is retained, not silently ignored', () => {
  const c = { sourceProjectId: options.sourceProjectId, title: '保留本地标题', stayDates: ['2027-02-01'], personalShortcuts: ['fictional-other'] }
  const result = convertPlannerSource(JSON.stringify(planner()), { ...options, localConfig: c })
  assert.equal(result.summary.readyForTrial, false); assert.ok(result.issues.some(i => i.code === 'LOCAL_CLOUD_DATE_DIFFERENCE'))
  assert.deepEqual(result.provenance.supplementalConfig, c)
})
test('conversion CLI writes only an explicit private dry-run artifact and keeps stdout redacted', async () => {
  const { mkdtemp, writeFile, readFile, rm, stat } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os'), { join } = await import('node:path'), { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'planner-conversion-test-'))
  try {
    const input = join(dir, 'source.json'), output = join(dir, 'candidate.json')
    await writeFile(input, JSON.stringify(planner()))
    const args = ['--experimental-strip-types', 'scripts/migration/convert-cli.mjs', '--input', input, '--source-system', 'supabase-planner', '--project-id', options.sourceProjectId, '--batch-id', options.batchId]
    const run = extra => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' })
    const dry = run([]); assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).mode, 'offline-dry-run')
    for (const text of ['虚构小明', '00123456789', '完整', 'fictional.invalid']) assert.ok(!dry.stdout.includes(text))
    await assert.rejects(readFile(output), { code: 'ENOENT' })
    assert.equal(run(['--output', output]).status, 0); assert.equal((await stat(output)).mode & 0o777, 0o600)
    const saved = await readFile(output, 'utf8'); assert.equal(run(['--output', output]).status, 1); assert.equal(await readFile(output, 'utf8'), saved)
    const bad = planner(); bad.guests[0].status = 'unknown'; await writeFile(input, JSON.stringify(bad)); assert.equal(run([]).status, 2)
    assert.equal(run(['--apply']).status, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
