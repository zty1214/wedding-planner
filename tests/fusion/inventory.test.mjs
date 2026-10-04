import test from 'node:test'
import assert from 'node:assert/strict'
import { inventory, readAllPages } from '../../scripts/fusion/inventory.mjs'
const fixture = () => ({ guests: [
  { id: 'g1', project_id: 'p', name: '小明', status: 'confirmed', table_id: 't', seat_index: 0, room_id: 'r', stay_dates: ['2026-10-01'] },
  { id: 'g2', project_id: 'p', name: '小明 2', status: 'assigned', table_id: 't', seat_index: 1, room_id: 'r', stay_dates: ['2026-10-02'] },
], tables: [{ id: 't', project_id: 'p', seats: 8, x: 0, y: 0, rotation: 0 }], rooms: [{ id: 'r', project_id: 'p' }],
notes: [{ id: 'n', project_id: 'p', content: 'private fixture text', images: ['https://private.invalid/image'] }],
project_config: [{ project_id: 'p', stay_dates: ['2026-10-01', '2026-10-02'] }] })
test('keeps distinct people and different nights, reporting only redacted aggregates', () => {
  const source = fixture(); const original = structuredClone(source)
  const report = inventory(source, 'p')
  assert.deepEqual(report.issues, [])
  assert.equal(report.counts.guests, 2)
  assert.equal(report.images.externalAvailability, 'NOT_CHECKED')
  for (const secret of ['小明', 'private fixture text', 'private.invalid']) assert.ok(!JSON.stringify(report).includes(secret))
  assert.deepEqual(source, original)
})
test('detects project mismatch, dangling references, duplicate seats and unknown statuses', () => {
  const source = fixture()
  Object.assign(source.guests[1], { project_id: 'other', status: 'unknown', seat_index: 0, room_id: 'missing', stay_dates: ['2026-02-30'] })
  const codes = inventory(source, 'p').issues.map(x => x.code)
  for (const code of ['PROJECT_MISMATCH', 'UNKNOWN_ATTENDANCE', 'DUPLICATE_SEAT', 'MISSING_ROOM_REFERENCE', 'INVALID_STAY_DATES']) assert.ok(codes.includes(code))
})
test('pagination handles server cap smaller than requested size', async () => {
  const data = Array.from({ length: 1005 }, (_, id) => ({ id }))
  const result = await readAllPages(async offset => ({ rows: data.slice(offset, offset + 100), count: data.length }))
  assert.deepEqual(result, data)
})
test('incomplete or changing count is rejected instead of reporting complete inventory', async () => {
  await assert.rejects(readAllPages(async () => ({ rows: [], count: 5 })), /INCOMPLETE_PAGE_COVERAGE/)
  await assert.rejects(readAllPages(async offset => ({ rows: [{ id: offset }], count: offset === 0 ? 5 : 6 })), /SOURCE_CHANGED_DURING_READ/)
})
test('missing cloud config flags reconciliation without classifying valid guest dates as malformed', () => {
  const source = fixture(); source.project_config = []
  const report = inventory(source, 'p')
  const codes = report.issues.map(x => x.code)
  assert.ok(codes.includes('MISSING_PROJECT_CONFIG'))
  assert.equal(codes.filter(c => c === 'STAY_DATE_NOT_IN_CONFIG').length, 2)
  assert.ok(!codes.includes('INVALID_STAY_DATES'))
  assert.deepEqual(source.guests[0].stay_dates, ['2026-10-01'])
})
