/** Reproducible synthetic scale check. No network, credentials, real data or cloud mutations. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { MemoryStore } from '../../tests/fusion/memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { assertCore, coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { commandService, hashSecret } from '../../server/fusion/commandService.ts'
import type { TransactionStore } from '../../server/fusion/commandService.ts'
import { noteService } from '../../server/fusion/noteService.ts'
import { historyService } from '../../server/fusion/historyService.ts'
import { closeDailyProject } from '../../server/fusion/dailySnapshots.ts'
import { assertGatewayRequestSize } from '../../src/fusion/protocol.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'
import { buildExportWorkbook } from '../../src/fusion/exportWorkbook.ts'
import { seatingExportModel } from '../../src/fusion/seatingExport.ts'
import type { VersionMeta } from '../../src/fusion/history.ts'

const data = emptyCore(), projectId = 'synthetic-scale', epoch = 'scale-epoch'
const secret = 'c'.repeat(64), manager = 'd'.repeat(64)
data.config.title = '纯虚构 150 人规模验收'
data.config.stayDates = ['2026-12-31', '2027-01-01']
for (let i = 0; i < 15; i++) {
  const id = `t${i}`; data.tableOrder.push(id)
  data.tables[id] = { id, revision: 0, label: `第${i + 1}桌`, seats: 10, x: 150 + (i % 5) * 250, y: 200 + Math.floor(i / 5) * 250, rotation: 0 }
}
for (let i = 0; i < 30; i++) {
  const id = `r${i}`; data.roomOrder.push(id)
  data.rooms[id] = { id, revision: 0, label: `0${String(i + 1).padStart(2, '0')}`, type: '标间', notes: '' }
}
for (let i = 0; i < 150; i++) {
  const id = `g${i}`; data.guestOrder.push(id)
  data.guests[id] = { id, revision: 0, name: i < 2 ? (i ? '虚构小明 2' : '虚构小明') : `虚构宾客${i + 1}`, group: i % 2 ? '新郎亲属' : '新娘朋友',
    phone: `00${String(i).padStart(9, '0')}`, notes: '仅用于测试，不是真实宾客', side: i % 2 ? 'groom' : 'bride', attendance: i % 5 ? 'confirmed' : 'pending',
    tableId: `t${Math.floor(i / 10)}`, seatIndex: i % 10, roomId: i < 60 ? `r${Math.floor(i / 2)}` : null,
    stayNeed: i < 60 ? 'needed' : 'not_needed', stayDates: i < 60 ? (i % 2 ? ['2027-01-01'] : [...data.config.stayDates]) : [] }
}
assertCore(data)
const memory = new MemoryStore()
memory.seed(projectId, { collaborationHash: hashSecret(secret), managementHash: hashSecret(manager) }, { dataEpoch: epoch, snapshotRevision: 0, data })
let stage = 'setup', clock = new Date('2026-07-07T04:00:00Z'), operation = 0
const calls: Record<string, Record<string, number>> = {}, durations: Record<string, number[]> = {}
const store: TransactionStore = { run(id, body) {
  const bucket = calls[stage] ??= {}; bucket.transactions = (bucket.transactions ?? 0) + 1
  return memory.run(id, tx => body(new Proxy(tx, { get(target, property) {
    const fn = Reflect.get(target, property)
    if (typeof fn !== 'function') return fn
    return (...args: unknown[]) => { const key = String(property); bucket[key] = (bucket[key] ?? 0) + 1; return Reflect.apply(fn, target, args) }
  } })))
} }
const core = commandService(store, coreHandlers(), () => clock), notes = noteService(store, () => clock), history = historyService(store, () => clock)
let maxRequestBytes = 0
function command(type: string, payload: Json, expectedRevisions: Record<string, number> = {}): Command {
  const c: Command = { projectId, dataEpoch: epoch, commandVersion: 1, operationId: `scale-${++operation}`, type, payload, expectedRevisions }
  const envelope = { action: 'execute', projectId, secret, command: c }
  assertGatewayRequestSize(envelope); maxRequestBytes = Math.max(maxRequestBytes, Buffer.byteLength(JSON.stringify(envelope)))
  return c
}
async function measured<T>(name: string, body: () => Promise<T>): Promise<T> {
  stage = name; const start = performance.now()
  try { return await body() } finally { (durations[name] ??= []).push(performance.now() - start) }
}
for (let i = 0; i < 12; i++) await measured('noteSetup', () => notes.execute(command('note.add', { id: `n${i}`, category: '酒店', title: `虚构笔记${i}`, content: '虚构备婚记录。'.repeat(286) }), secret))
const start = clock.getTime()
for (let day = 0; day < 90; day++) {
  clock = new Date(start + day * 86400000)
  await measured('tableMove', () => core.execute(command('table.move', { id: 't0', x: 151 + day, y: 200 }, { 'table:t0': day }), secret))
  clock = new Date(start + (day + 1) * 86400000)
  await measured('dailySnapshot', () => closeDailyProject(store, projectId, () => clock))
}
const beforeRestore = memory.projects.get(projectId)!
assert.equal(beforeRestore.versions.size, 90)
assert.equal(beforeRestore.history.length, 90)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const dailyBodiesBytes = [...beforeRestore.versions.values()].reduce((sum, v) => sum + bytes(v), 0)
const metaBytes = bytes(beforeRestore.history)
let cursor: string | null = null; const listed: VersionMeta[] = [], pageBytes: number[] = []
do {
  const page = await measured('historyPage', () => history.list(projectId, secret, cursor))
  pageBytes.push(bytes(page)); listed.push(...page.versions); cursor = page.nextCursor
} while (cursor)
assert.equal(listed.length, 90); assert.equal(new Set(listed.map(v => v.id)).size, 90)
assert.equal(pageBytes.length, 5)
const target = await measured('versionRead', () => history.read(projectId, secret, listed.at(-1)!.id))
assert.deepEqual(target.counts, { guests: 150, tables: 15, rooms: 30, notes: 12 })
const snapshot = await measured('projectRead', () => notes.read(projectId, secret))
const accessBefore = structuredClone(beforeRestore.access)
const receipt = await measured('restore', () => history.execute(command('version.restore', { id: target.id }, { snapshot: snapshot.current.snapshotRevision, notes: snapshot.notesRevision }), manager))
assert.ok(receipt.resultDataEpoch); assert.notEqual(receipt.resultDataEpoch, epoch)
const restored = await measured('restoredRead', () => notes.read(projectId, secret))
assert.deepEqual(restored.current.data, target.core); assert.deepEqual(restored.notes, target.notes)
assert.deepEqual(memory.projects.get(projectId)!.access, accessBefore)
assert.equal(memory.projects.get(projectId)!.history.filter(v => v.kind === 'safety').length, 1)
const frozen = { projectId, source: 'confirmed' as const, capturedAt: clock.toISOString(), snapshot: {
  dataEpoch: restored.dataEpoch, snapshotRevision: restored.current.snapshotRevision, data: target.core, notes: restored.notes, notesRevision: restored.notesRevision } }
const exportBytes: Record<string, number> = {}
for (const kind of ['guests', 'rooms'] as const) await measured(`${kind}Workbook`, async () => {
  const { workbook } = buildExportWorkbook(frozen, kind)
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }); exportBytes[kind] = buffer.length
  const decoded = XLSX.read(buffer, { type: 'buffer' })
  if (kind === 'guests') {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(decoded.Sheets['宾客名单'])
    assert.equal(rows.length, 150); assert.equal(rows[0].电话, '00000000000'); assert.equal(rows[1].姓名, '虚构小明 2')
  } else {
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(decoded.Sheets['每晚用房'])
    assert.deepEqual(rows.map(r => r.日期), ['2026-12-31', '2027-01-01'])
    assert.deepEqual(rows.map(r => r.当晚入住人数), [30, 60])
    assert.deepEqual(rows.map(r => r.合计用房), [30, 30])
  }
})
const seating = seatingExportModel(frozen)
assert.equal(seating.stats.seated, 150); assert.equal(seating.stats.seats, 150)
const round = (n: number) => Math.round(n * 100) / 100
const report = {
  generatedAt: new Date().toISOString(), runtime: process.version, evidence: 'local-memory-store-only',
  limits: ['No CloudBase requests or quota measurements', 'MemoryStore clones whole project per transaction; timings are not cloud latency', 'Workbook buffers read back programmatically; browser download and 150-person PNG readability not tested'],
  fixture: { guests: 150, tables: 15, rooms: 30, notes: 12, noteCharactersEach: 2002, changedDays: 90, firstDay: '2026-07-07', lastDay: '2026-10-04' },
  serializedBytes: { currentCore: bytes(snapshot.current), notes: bytes(snapshot.notes), singleDailyBody: bytes(target), dailyBodies90: dailyBodiesBytes,
    historyIndex90: metaBytes, maximumHistoryPage: Math.max(...pageBytes), largestCommandEnvelope: maxRequestBytes, exports: exportBytes },
  timingsMs: Object.fromEntries(Object.entries(durations).map(([key, values]) => { const sorted = [...values].sort((a, b) => a - b); return [key, { samples: values.length, min: round(sorted[0]), median: round(sorted[Math.floor(sorted.length / 2)]), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]), max: round(sorted.at(-1)!) }] })),
  logicalTransactionCalls: calls,
  checks: { dailyVersions: 90, metadataPages: 5, restoreCoreAndNotesEqual: true, safetyVersionCreated: true, credentialsUnchanged: true, workbookRowsAndLeadingZerosAndCrossYearDates: true, seated: 150 },
}
const output = JSON.stringify(report, null, 2) + '\n'
if (process.argv[2]) await writeFile(process.argv[2], output)
else process.stdout.write(JSON.stringify({ evidence: report.evidence, fixture: report.fixture, serializedBytes: report.serializedBytes, checks: report.checks }, null, 2) + '\n')
