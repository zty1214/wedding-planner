import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { collectBackupSource, sealBackup, openBackup, backupSummary } from '../../scripts/migration/backup.mjs'
const metadata = { sourceSystem: 'supabase-planner', sourceProjectId: 'fictional-project', schema: 'planner-source-v1', exportedAt: '2026-10-08T00:00:00Z' }
const rows = [{ id: 'g1', name: '虚构小明', phone: '00123456789', seat_index: 0, stay_dates: ['2026-12-31'], content: '完整\n正文', images: ['https://fictional.invalid/old-image'] }, { id: 'g2', name: '虚构小明 2', phone: '', seat_index: 1, stay_dates: ['2027-01-01'] }]
const collect = () => collectBackupSource(metadata, ['guests', 'empty'], async name => ({ rows: name === 'guests' ? rows : [], count: name === 'guests' ? 2 : 0 }))
test('encrypted backup restores exact source bytes, metadata and old attachment references without leaking records', async () => {
  const source = await collect(), rawJson = JSON.stringify(JSON.parse(source.rawJson), null, 2) + '\n', key = randomBytes(32)
  const envelope = sealBackup(rawJson, source.manifest, key)
  for (const value of ['虚构小明', '00123456789', 'fictional-project', 'fictional.invalid']) assert.ok(!JSON.stringify(envelope).includes(value))
  const restored = openBackup(envelope, key)
  assert.equal(restored.rawJson, rawJson)
  assert.deepEqual(restored.manifest, source.manifest)
  assert.deepEqual(JSON.parse(restored.rawJson).guests, rows)
  const summary = backupSummary(restored)
  assert.deepEqual(summary.counts, { guests: 2, empty: 0 })
  assert.equal(summary.consistency, 'preliminary')
  assert.ok(!JSON.stringify(summary).includes('虚构'))
  assert.notEqual(sealBackup(rawJson, source.manifest, key).iv, envelope.iv)
})
test('wrong key, corrupted ciphertext and authentication tag cannot be restored', async () => {
  const source = await collect(), key = randomBytes(32), envelope = sealBackup(source.rawJson, source.manifest, key)
  assert.throws(() => openBackup(envelope, randomBytes(32)), /BACKUP_AUTHENTICATION_FAILED/)
  for (const field of ['data', 'tag', 'iv']) {
    const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1
    assert.throws(() => openBackup({ ...envelope, [field]: bytes.toString('base64') }, key), /BACKUP_AUTHENTICATION_FAILED/)
  }
})
test('incomplete, altered and falsely frozen source manifests are rejected before encryption', async () => {
  const source = await collect(), key = randomBytes(32)
  const missing = structuredClone(source.manifest); missing.collections.guests.pages = []
  assert.throws(() => sealBackup(source.rawJson, missing, key), /INCOMPLETE_PAGE_COVERAGE/)
  const altered = JSON.parse(source.rawJson); altered.guests[0].phone = 'different'
  assert.throws(() => sealBackup(JSON.stringify(altered), source.manifest, key), /INVALID_PAGE_PROOF/)
  assert.throws(() => sealBackup(source.rawJson, { ...source.manifest, consistency: 'frozen' }, key), /INVALID_SOURCE_MANIFEST/)
})
test('backup collector covers server-capped pages with exact offsets and rejects missing or duplicate rows', async () => {
  const data = Array.from({ length: 1005 }, (_, i) => ({ id: 'g' + i })), offsets = []
  const collected = await collectBackupSource(metadata, ['guests'], async (name, offset) => { offsets.push(offset); return { rows: data.slice(offset, offset + 100), count: data.length } })
  assert.deepEqual(JSON.parse(collected.rawJson).guests, data)
  assert.deepEqual(offsets, [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])
  await assert.rejects(collectBackupSource(metadata, ['guests'], async () => ({ rows: [], count: 1 })), /INCOMPLETE_PAGE_COVERAGE/)
  await assert.rejects(collectBackupSource(metadata, ['guests'], async () => ({ rows: [rows[0]], count: 2 })), /DUPLICATE_OR_MISSING_SOURCE_ID/)
  await assert.rejects(collectBackupSource(metadata, ['guests'], async (_, offset) => ({ rows: [rows[offset]], count: offset ? 3 : 2 })), /SOURCE_CHANGED_DURING_READ/)
})
test('CLI defaults to verification, uses separate private keys and never overwrites output or enters a Git checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-backup-test-'))
  try {
    const source = await collect(), raw = join(dir, 'raw.json'), manifest = join(dir, 'metadata.json'), key = join(dir, 'key'), sealed = join(dir, 'sealed.json'), restored = join(dir, 'restored.json')
    await writeFile(raw, source.rawJson); await writeFile(manifest, JSON.stringify(source.manifest))
    const cli = args => spawnSync(process.execPath, ['scripts/migration/backup-cli.mjs', ...args], { encoding: 'utf8' })
    assert.equal(cli(['--mode', 'keygen', '--key-file', key]).status, 0)
    assert.equal((await stat(key)).mode & 0o777, 0o600)
    assert.equal(cli(['--mode', 'seal', '--input', raw, '--metadata', manifest, '--key-file', key, '--output', sealed]).status, 0)
    const verified = cli(['--input', sealed, '--key-file', key])
    assert.equal(verified.status, 0); assert.equal(JSON.parse(verified.stdout).restoredOfflineFile, false)
    await assert.rejects(readFile(restored), { code: 'ENOENT' })
    assert.equal(cli(['--mode', 'restore', '--input', sealed, '--key-file', key, '--output', restored]).status, 0)
    assert.equal(await readFile(restored, 'utf8'), source.rawJson)
    await writeFile(restored, 'keep-existing')
    assert.equal(cli(['--mode', 'restore', '--input', sealed, '--key-file', key, '--output', restored]).status, 1)
    assert.equal(await readFile(restored, 'utf8'), 'keep-existing')
    const repo = join(dir, 'repo'); await mkdir(repo); await mkdir(join(repo, '.git'))
    assert.match(cli(['--mode', 'keygen', '--key-file', join(repo, 'key')]).stderr, /GIT_WORKTREE_PATH_FORBIDDEN/)
    await writeFile(join(repo, 'private-key'), randomBytes(32), { mode: 0o600 }); await symlink(join(repo, 'private-key'), join(dir, 'linked-key'))
    assert.match(cli(['--input', sealed, '--key-file', join(dir, 'linked-key')]).stderr, /GIT_WORKTREE_PATH_FORBIDDEN/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
