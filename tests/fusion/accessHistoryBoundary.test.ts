import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { MemoryStore } from './memoryStore.ts'
import { emptyCore } from '../../src/fusion/core.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { buildExportWorkbook } from '../../src/fusion/exportWorkbook.ts'
import { seatingExportModel } from '../../src/fusion/seatingExport.ts'
import type { Command, Json } from '../../src/fusion/protocol.ts'

function fixture() {
  const store = new MemoryStore(), old = randomBytes(32).toString('hex'), manager = randomBytes(32).toString('hex'), next = randomBytes(32).toString('hex')
  store.seed('a', { managementHash: hashSecret(manager), collaborationHash: hashSecret(old) }, { dataEpoch: 'e', snapshotRevision: 0, data: emptyCore() })
  const gateway = probeGateway(store, ['a'])
  const admin = gatewayTransport('a', manager, gateway), collaborator = gatewayTransport('a', old, gateway), renewed = gatewayTransport('a', next, gateway)
  const command = (type: string, payload: Json, expectedRevisions: Record<string, number> = {}, dataEpoch = 'e'): Command => ({ projectId: 'a', dataEpoch, operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions })
  return { store, old, manager, next, admin, collaborator, renewed, command }
}

test('restoring a pre-rotation version never resurrects the revoked link or rolls access revision back', async () => {
  const { store, next, admin, collaborator, renewed, command } = fixture()
  await collaborator.execute(command('guest.add', { id: 'g', name: '恢复点宾客', group: '' }))
  await admin.execute(command('version.save', { name: '撤权前版本' }, { snapshot: 1, notes: 0 }))
  const target = (await admin.readHistory!()).versions[0]
  const rotation = command('access.rotateCollaboration', { collaborationHash: hashSecret(next) }, { access: 0 })
  const rotationReceipt = await admin.execute(rotation)
  const frozenAccess = structuredClone(store.projects.get('a')!.access)
  await renewed.execute(command('guest.update', { id: 'g', patch: { name: '撤权后修改' } }, { 'guest:g': 0 }))
  const restore = command('version.restore', { id: target.id }, { snapshot: 2, notes: 0 })
  await assert.rejects(renewed.execute(restore), { code: 'FORBIDDEN' })
  const receipt = await admin.execute(restore)
  assert.notEqual(receipt.resultDataEpoch, 'e')
  assert.equal((await renewed.read()).data.guests.g.name, '恢复点宾客')
  assert.deepEqual(store.projects.get('a')!.access, frozenAccess)
  assert.deepEqual(await admin.readAccess!(hashSecret(next)), { revision: 1, matches: true })
  await assert.rejects(collaborator.read(), { code: 'FORBIDDEN' })
  await assert.rejects(collaborator.queryReceipt(rotation), { code: 'FORBIDDEN' })
  await assert.rejects(collaborator.execute(command('guest.add', { id: 'denied', name: '旧链接', group: '' }, {}, receipt.resultDataEpoch!)), { code: 'FORBIDDEN' })
  assert.deepEqual(await admin.queryReceipt(rotation), rotationReceipt)
  assert.deepEqual(await admin.execute(restore), receipt)
  assert.equal((await admin.readHistory!()).versions.filter(v => v.kind === 'safety').length, 1)
})

test('access secrets and stored digests never enter shared versions, receipts, activity or export models', async () => {
  const { manager, old, next, admin, collaborator, command } = fixture()
  const guest = command('guest.add', { id: 'g', name: '导出宾客', group: '', phone: '00123' })
  const responses: unknown[] = [await collaborator.execute(guest)]
  responses.push(await admin.execute(command('version.save', { name: '固定版本' }, { snapshot: 1, notes: 0 })))
  responses.push(await admin.execute(command('access.rotateCollaboration', { collaborationHash: hashSecret(next) }, { access: 0 })))
  const history = await admin.readHistory!(), snapshot = await admin.read()
  responses.push(history, snapshot, await admin.readVersion!(history.versions[0].id), await admin.readRecycle!(), await admin.readAccess!(hashSecret(next)))
  responses.push(await admin.readActivityMonth!(history.versions[0].businessDate.slice(0, 7)))
  const exported = { projectId: 'a', source: 'confirmed' as const, capturedAt: new Date().toISOString(), snapshot }
  responses.push(buildExportWorkbook(exported, 'guests'), buildExportWorkbook(exported, 'rooms'), seatingExportModel(exported))
  const text = JSON.stringify(responses)
  for (const secret of [manager, old, next]) {
    assert.equal(text.includes(secret), false)
    assert.equal(text.includes(hashSecret(secret)), false)
  }
})


test('downloaded XLSX bytes and workbook metadata exclude link secrets after rotation', async () => {
  const { manager, old, next, admin, collaborator, command } = fixture()
  await collaborator.execute(command('guest.add', { id: 'g', name: '文件审计宾客', group: '', phone: '00123' }))
  await admin.execute(command('access.rotateCollaboration', { collaborationHash: hashSecret(next) }, { access: 0 }))
  const snapshot = await admin.read()
  const directory = await mkdtemp(join(tmpdir(), 'planner-export-boundary-'))
  try {
    for (const kind of ['guests', 'rooms'] as const) {
      const artifact = buildExportWorkbook({ projectId: 'a', source: 'confirmed', capturedAt: new Date().toISOString(), snapshot }, kind)
      const path = join(directory, artifact.filename)
      // Same writeFile defaults as ExportPanel. ZIP entries are uncompressed by default.
      XLSX.writeFile(artifact.workbook, path)
      const bytes = await readFile(path), raw = bytes.toString('utf8')
      assert.ok(raw.includes('docProps/core.xml'))
      assert.ok(raw.includes('<dc:subject>'), 'audit includes serialized provenance metadata')
      const parsed = XLSX.read(bytes, { type: 'buffer' })
      assert.ok(parsed.Props?.Subject?.includes('项目 a'))
      if (kind === 'guests') {
        assert.equal(parsed.Sheets['宾客名单'].A2.v, '文件审计宾客')
        assert.equal(parsed.Sheets['宾客名单'].B2.v, '00123')
      }
      for (const secret of [manager, old, next]) {
        for (const forbidden of [secret, hashSecret(secret)]) {
          assert.equal(raw.includes(forbidden), false, 'serialized XLSX must not contain access credentials')
          assert.equal(JSON.stringify(parsed).includes(forbidden), false)
          assert.equal(artifact.filename.includes(forbidden), false)
        }
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
