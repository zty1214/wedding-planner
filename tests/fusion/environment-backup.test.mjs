import test from 'node:test'
import assert from 'node:assert/strict'
import { EJSON, ObjectId } from 'bson'
import { randomBytes } from 'node:crypto'
import { collectEnvironmentDatabase } from '../../scripts/migration/environment-backup.mjs'
import { sealBackup, openBackup } from '../../scripts/migration/backup.mjs'
test('whole environment export includes empty collections, complete pages, storage and BSON dates', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ _id: 'doc-' + String(i).padStart(3, '0'), time: new Date('2026-10-08T00:00:00Z'), nested: { original: i } }))
  const db = { config: { envName: 'fictional-env' }, collection: name => ({ count: async () => ({ total: name === 'empty' ? 0 : rows.length }), orderBy: () => ({ skip: offset => ({ limit: size => ({ get: async () => ({ data: name === 'empty' ? [] : rows.slice(offset, offset + size) }) }) }) }) }) }
  const a = await collectEnvironmentDatabase(db, ['documents', 'empty'], {}, { cloudbase_storage_objects: [{ _id: 'file-1', bodyBase64: 'YWJj' }] })
  const key = randomBytes(32), restored = openBackup(sealBackup(a.rawJson, a.manifest, key), key)
  const data = JSON.parse(restored.rawJson)
  assert.deepEqual(data.empty, []); assert.equal(data.documents.length, 205)
  assert.deepEqual(data.documents.map(d => EJSON.deserialize(d)), rows)
  assert.equal(data.cloudbase_storage_objects[0].bodyBase64, 'YWJj')
  assert.deepEqual(a.manifest.collections.documents.pages.map(p => p.length), [100, 100, 5])
})
test('environment backup refuses count changes rather than silently exporting a partial collection', async () => {
  let count = 0
  const db = { config: { envName: 'fictional-env' }, collection: () => ({ count: async () => ({ total: ++count }), orderBy: () => ({ skip: () => ({ limit: () => ({ get: async () => ({ data: [{ _id: 'example' }] }) }) }) }) }) }
  await assert.rejects(collectEnvironmentDatabase(db, ['documents']), /SOURCE_CHANGED_DURING_READ/)
})


test('environment backup explicitly refuses ObjectId and numeric document IDs without claiming a complete backup', async () => {
  for (const id of [new ObjectId('000000000000000000000001'), 42]) {
    const rows = [{ _id: id, original: 'fictitious' }]
    const db = { config: { envName: 'fictional-env' }, collection: () => ({ count: async () => ({ total: 1 }), orderBy: () => ({ skip: offset => ({ limit: size => ({ get: async () => ({ data: rows.slice(offset, offset + size) }) }) }) }) }) }
    await assert.rejects(collectEnvironmentDatabase(db, ['documents']), /UNSUPPORTED_SOURCE_ID_TYPE/)
  }
})
