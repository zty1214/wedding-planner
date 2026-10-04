import { open } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { cloudApi } from './cloudbase-cli.mjs'

const [output] = process.argv.slice(2)
if (!output) throw Error('Provide a fresh permission audit report path')
const file = await open(output, 'wx', 0o600)
const env = 'dev-d1gh3jw1gdf06af22', name = 'planner-fusion-gateway-probe'
const report = { observedAt: new Date().toISOString(), env, functionName: name }
function read() {
  const result = cloudApi('DescribeResourcePermission', { EnvId: env, ResourceType: 'function' })
  assert.equal(result.Data.PermissionList.length, 1)
  return JSON.parse(result.Data.PermissionList[0].SecurityRule)
}
try {
  report.before = read()
  assert.ok(report.before['*'])
  report.after = { ...report.before, [name]: { invoke: 'auth != null' } }
  // Save original policy before mutation; never migrate to environment-wide OPA here.
  await file.writeFile(JSON.stringify(report, null, 2) + '\n')
  assert.deepEqual(read(), report.before)
  const result = cloudApi('ModifyResourcePermission', { EnvId: env, ResourceType: 'function', Permission: 'CUSTOM', SecurityRule: JSON.stringify(report.after) })
  assert.equal(result.Data.Success, true)
  assert.deepEqual(read(), report.after)
  report.status = 'PASS'
} catch {
  report.status = 'FAIL'; process.exitCode = 1
}
await file.truncate(0)
await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8')
await file.close()
console.log(JSON.stringify(report))
