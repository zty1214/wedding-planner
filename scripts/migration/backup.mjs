// Offline encrypted source export. No network, cloud credentials or database writes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
const hash = value => createHash('sha256').update(value).digest('hex')
const format = 'planner-encrypted-source-backup-v1'
const aad = Buffer.from(format)
function fail(code) { throw Error(code) }
function validate(rawJson, manifest) {
  let source
  try { source = JSON.parse(rawJson) } catch { fail('INVALID_SOURCE_JSON') }
  if (!manifest || manifest.format !== 'planner-source-manifest-v1'
    || !['supabase-planner', 'cloudbase-wedding', 'browser-local', 'fusion-project', 'cloudbase-environment'].includes(manifest.sourceSystem)
    || typeof manifest.sourceProjectId !== 'string' || !manifest.sourceProjectId
    || typeof manifest.schema !== 'string' || !manifest.schema
    || !Number.isFinite(Date.parse(manifest.exportedAt))
    || !['preliminary', 'frozen'].includes(manifest.consistency)
    || (manifest.consistency === 'frozen' && !manifest.freezeEvidenceHash?.match(/^[a-f0-9]{64}$/))
    || !source || typeof source !== 'object' || Array.isArray(source)
    || !manifest.collections || Object.keys(source).length !== Object.keys(manifest.collections).length) fail('INVALID_SOURCE_MANIFEST')
  for (const [name, rows] of Object.entries(source)) {
    const proof = manifest.collections[name]
    if (!Array.isArray(rows) || !proof || proof.count !== rows.length || !Array.isArray(proof.pages)) fail('INCOMPLETE_PAGE_COVERAGE')
    let offset = 0
    for (const page of proof.pages) {
      if (page.offset !== offset || !Number.isSafeInteger(page.length) || page.length < 0
        || page.count !== rows.length || page.hash !== hash(JSON.stringify(rows.slice(offset, offset + page.length)))
        || (page.length === 0 && rows.length !== 0)) fail('INVALID_PAGE_PROOF')
      offset += page.length
    }
    if (!proof.pages.length || offset !== rows.length) fail('INCOMPLETE_PAGE_COVERAGE')
  }
  return source
}
/** Exact-count pagination; caller supplies a project-scoped, stable ordered reader. */
export async function collectBackupSource(metadata, collections, readPage) {
  if (!Array.isArray(collections) || !collections.length || new Set(collections).size !== collections.length) fail('INVALID_COLLECTIONS')
  const source = {}, proofs = {}
  for (const name of collections) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/.test(name)) fail('INVALID_COLLECTION_NAME')
    const rows = [], pages = [], ids = new Set()
    let expected
    while (true) {
      const page = await readPage(name, rows.length, 500)
      if (!Array.isArray(page.rows) || !Number.isSafeInteger(page.count) || page.count < 0) fail('INVALID_SOURCE_PAGE')
      if (expected !== undefined && expected !== page.count) fail('SOURCE_CHANGED_DURING_READ')
      expected = page.count
      if (!page.rows.length && rows.length < expected) fail('INCOMPLETE_PAGE_COVERAGE')
      for (const row of page.rows) {
        const id = row?._id ?? row?.id ?? row?.project_id
        if (typeof id !== 'string' || !id || ids.has(id)) fail('DUPLICATE_OR_MISSING_SOURCE_ID')
        ids.add(id)
      }
      pages.push({ offset: rows.length, length: page.rows.length, count: expected, hash: hash(JSON.stringify(page.rows)) })
      rows.push(...page.rows)
      if (rows.length > expected) fail('PAGE_COUNT_MISMATCH')
      if (rows.length === expected) break
    }
    source[name] = rows; proofs[name] = { count: expected, pages }
  }
  const rawJson = JSON.stringify(source)
  const manifest = { ...metadata, format: 'planner-source-manifest-v1', consistency: metadata.consistency ?? 'preliminary', collections: proofs }
  validate(rawJson, manifest)
  return { rawJson, manifest }
}
export function sealBackup(rawJson, manifest, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('INVALID_BACKUP_KEY')
  validate(rawJson, manifest)
  const payload = { rawJson, manifest, sourceHash: hash(rawJson) }
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { format, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}
export function openBackup(envelope, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('INVALID_BACKUP_KEY')
  if (!envelope || envelope.format !== format || envelope.algorithm !== 'aes-256-gcm') fail('INVALID_BACKUP_FORMAT')
  let payload
  try {
    const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64')
    if (iv.length !== 12 || tag.length !== 16) fail('INVALID_ENVELOPE')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad); decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
    payload = JSON.parse(plaintext.toString('utf8'))
  } catch { fail('BACKUP_AUTHENTICATION_FAILED') }
  validate(payload.rawJson, payload.manifest)
  if (hash(payload.rawJson) !== payload.sourceHash) fail('SOURCE_HASH_MISMATCH')
  return payload
}
export function backupSummary(payload) {
  return { status: 'verified', sourceHash: payload.sourceHash, consistency: payload.manifest.consistency,
    counts: Object.fromEntries(Object.entries(payload.manifest.collections).map(([name, value]) => [name, value.count])) }
}
