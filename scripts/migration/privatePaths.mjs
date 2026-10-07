import { realpath, access } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'

export async function controlledPath(path) {
  if (!path) throw Error('EXPLICIT_PRIVATE_PATH_REQUIRED')
  const target = resolve(path), parent = await realpath(dirname(target))
  let existing
  try { existing = await realpath(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  let current = existing ? dirname(existing) : parent
  while (true) {
    try { await access(join(current, '.git')); throw Error('GIT_WORKTREE_PATH_FORBIDDEN') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (current === parse(current).root) break
    current = dirname(current)
  }
  return join(parent, basename(target))
}
