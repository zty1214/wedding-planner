import test from 'node:test'
import assert from 'node:assert/strict'
import { probeImages, imageFileId, PROBE_PNG } from '../../server/fusion/probeImages.ts'
import { probeGateway } from '../../server/fusion/probeGateway.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { MemoryStore } from './memoryStore.ts'
const project = 'fusion-gateway-00000000-0000-0000-0000-000000000001'
const other = 'fusion-gateway-00000000-0000-0000-0000-000000000002'
const secret = 'a'.repeat(64)
function setup() {
  const store = new MemoryStore()
  store.seed(project, { collaborationHash: hashSecret(secret), managementHash: hashSecret('b'.repeat(64)) }, { dataEpoch: 'e', snapshotRevision: 0, data: 0 })
  let calls = 0, duringRead = () => {}
  const storage = {
    uploadFile: async () => { calls++; return { fileID: imageFileId(project) } },
    downloadFile: async () => { calls++; duringRead(); return { fileContent: Buffer.from(PROBE_PNG, 'base64') } },
    deleteFile: async () => { calls++; return { fileList: [{ code: 'SUCCESS' }] } },
  }
  return { store, storage, calls: () => calls, onRead: fn => { duringRead = fn }, call: probeGateway(store, [project, other], probeImages(storage)) }
}
test('image gateway refuses cross-project/file substitution and invalid content before storage I/O', async () => {
  const s = setup()
  for (const action of ['image.upload', 'image.read', 'image.delete']) {
    for (const extra of [{ projectId: other }, { secret: 'c'.repeat(64) }, { fileID: imageFileId(other) }, { fileID: '../../real-data.png' }]) {
      const r = await s.call({ action, projectId: project, secret, fileID: imageFileId(project), base64: PROBE_PNG, ...extra })
      assert.equal(r.error.code, 'FORBIDDEN')
    }
  }
  assert.equal((await s.call({ action: 'image.upload', projectId: project, secret, fileID: imageFileId(project), base64: 'not-a-png' })).error.code, 'INVALID_INPUT')
  assert.equal(s.calls(), 0)
})
test('revocation during file read prevents content delivery', async () => {
  const s = setup()
  s.onRead(() => { s.store.projects.get(project).access.collaborationHash = hashSecret('new') })
  assert.deepEqual(await s.call({ action: 'image.read', projectId: project, secret, fileID: imageFileId(project) }), { ok: false, error: { code: 'FORBIDDEN' } })
})
test('returned storage error or partial deletion never produces success', async () => {
  const s = setup()
  s.storage.uploadFile = async () => ({ code: 'STORAGE_ERROR' })
  s.storage.deleteFile = async () => ({ fileList: [{ code: 'ACCESS_DENIED' }] })
  for (const action of ['image.upload', 'image.delete']) {
    assert.deepEqual(await s.call({ action, projectId: project, secret, fileID: imageFileId(project), base64: PROBE_PNG }), { ok: false, error: { code: 'INTERNAL_ERROR' } })
  }
})
