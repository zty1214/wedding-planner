import { controlledPath } from './privatePaths.mjs'
// Default verifies only. An explicit restore produces a private offline file,
// never a live database restore. Keys and raw backups stay outside Git worktrees.
import { parseArgs } from 'node:util'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { sealBackup, openBackup, backupSummary } from './backup.mjs'

try {
  const { values } = parseArgs({ options: Object.fromEntries(['mode', 'input', 'metadata', 'key-file', 'output'].map(k => [k, { type: 'string' }])) })
  const mode = values.mode ?? 'verify'
  if (!['keygen', 'seal', 'verify', 'restore'].includes(mode)) throw Error('INVALID_BACKUP_MODE')
  const keyPath = await controlledPath(values['key-file'])
  if (mode === 'keygen') {
    await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ status: 'key-created', bytes: 32 }))
  } else {
    if (process.platform !== 'win32' && ((await stat(keyPath)).mode & 0o077)) throw Error('BACKUP_KEY_PERMISSIONS_TOO_OPEN')
    const key = await readFile(keyPath), input = await controlledPath(values.input)
    if (mode === 'seal') {
      const raw = await readFile(input, 'utf8'), metadata = JSON.parse(await readFile(await controlledPath(values.metadata), 'utf8'))
      const envelope = sealBackup(raw, metadata, key)
      await writeFile(await controlledPath(values.output), JSON.stringify(envelope) + '\n', { flag: 'wx', mode: 0o600 })
      console.log(JSON.stringify(backupSummary(openBackup(envelope, key))))
    } else {
      const payload = openBackup(JSON.parse(await readFile(input, 'utf8')), key)
      if (mode === 'restore') await writeFile(await controlledPath(values.output), payload.rawJson, { flag: 'wx', mode: 0o600 })
      else if (values.output) throw Error('VERIFY_DOES_NOT_WRITE_OUTPUT')
      console.log(JSON.stringify({ ...backupSummary(payload), restoredOfflineFile: mode === 'restore' }))
    }
  }
} catch (error) {
  // No raw file contents, paths, records, keys, or SDK errors in console output.
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'BACKUP_OPERATION_FAILED'
  console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1
}
