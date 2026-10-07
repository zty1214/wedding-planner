import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyCore } from '../../src/fusion/core.ts'
import { seatingExportModel } from '../../src/fusion/seatingExport.ts'
import type { ExportSnapshot } from '../../src/fusion/repository.ts'

test('seating export keeps geometry, attendance totals and provenance in one detached snapshot', () => {
  const core = emptyCore()
  core.config.title = '固定版本'
  core.config.mainStagePos = { x: -800, y: -600 }
  core.tableOrder = ['t']
  core.tables.t = { id: 't', label: '一桌', seats: 8, x: 1600, y: 900, rotation: 90, revision: 0 }
  core.guestOrder = ['g']
  core.guests.g = { id: 'g', name: '确认但未排座', group: '', phone: '', notes: '', side: 'shared', attendance: 'confirmed', tableId: null, seatIndex: null, roomId: null, stayNeed: 'pending', stayDates: [], revision: 0 }
  const value: ExportSnapshot = { projectId: 'a', source: 'confirmed', capturedAt: '2026-10-05T03:00:00.000Z', snapshot: { dataEpoch: 'e', snapshotRevision: 7, data: core } }
  const model = seatingExportModel(value)
  core.config.title = '后续修改'; core.tables.t.x = 0; core.guests.g.name = '后续改名'
  assert.equal(model.title, '固定版本'); assert.equal(model.data.tables[0].x, 1600)
  assert.equal(model.data.guests[0].name, '确认但未排座')
  assert.deepEqual(model.stats, { tables: 1, seats: 8, seated: 0, confirmed: 1 })
  const v = model.viewport
  for (const p of [model.data.mainStagePos, model.data.tables[0]]) {
    assert.ok(p.x * v.scale + v.x > 0 && p.x * v.scale + v.x < v.width)
    assert.ok(p.y * v.scale + v.y > 0 && p.y * v.scale + v.y < v.height)
  }
  assert.match(model.filename, /云端已确认_r7/)
  assert.match(seatingExportModel({ ...value, source: 'draft' }).provenance, /本机未同步草稿/)
})

test('seat labels never drop numeric suffixes, whitespace or Unicode characters', async () => {
  const { seatNameLayout } = await import('../../src/utils/seatName.ts')
  for (const name of ['小明', '小明 2', '验收甲 2', '欧阳名字较长的朋友', '朋友😀 2']) {
    const layout = seatNameLayout(name)
    assert.equal(layout.text.replaceAll('\n', ''), name)
    assert.ok(layout.fontSize > 0 && layout.fontSize <= 11)
    assert.ok(layout.text.split('\n').length * layout.fontSize * 1.1 <= 28.001)
  }
  assert.notEqual(seatNameLayout('验收甲').text, seatNameLayout('验收甲 2').text)
})
