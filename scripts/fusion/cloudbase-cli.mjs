import { execFileSync } from 'node:child_process'

// CLI output containing credentials is captured in memory only. Never echo it or attach it to errors.
function cliJson(args) {
  let stdout
  try { stdout = execFileSync('tcb', [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 }) }
  catch { throw Error('CLOUDBASE_CLI_FAILED_CHECK_LOGIN_AND_NETWORK') }
  let parsed
  try { parsed = JSON.parse(stdout.slice(stdout.indexOf('{'))) }
  catch { throw Error('CLOUDBASE_CLI_INVALID_JSON') }
  if (parsed.error) throw Error('CLOUDBASE_CLI_API_FAILED')
  return parsed.data ?? parsed
}
export const cloudApi = (action, body) => cliJson(['api', 'tcb', action, '--region', 'ap-shanghai', '--body', JSON.stringify(body)])
export const functionDetail = (env, name) => cliJson(['fn', 'detail', name, '-e', env, '--region', 'ap-shanghai'])
export function temporaryCredential(env) {
  const value = cliJson(['secrets', 'get', '-e', env])
  if (!value.isTemporary || !value.secretId || !value.secretKey || !value.token) throw Error('TEMPORARY_CREDENTIAL_REQUIRED')
  return { secretId: value.secretId, secretKey: value.secretKey, sessionToken: value.token }
}

export const invokeFunction = (env, name) => cliJson(['fn', 'invoke', name, '-e', env, '--region', 'ap-shanghai', '-d', '{}'])
