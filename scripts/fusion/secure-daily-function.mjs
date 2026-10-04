import { open } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { cloudApi } from './cloudbase-cli.mjs'
const [output] = process.argv.slice(2)
if (!output) throw Error('Provide fresh audit report path')
const env = 'dev-d1gh3jw1gdf06af22', name = 'planner-fusion-daily-probe'
const file = await open(output, 'wx', 0o600)
const read = () => JSON.parse(cloudApi('DescribeResourcePermission', { EnvId: env, ResourceType: 'function' }).Data.PermissionList[0].SecurityRule)
const report = { env, functionName: name, observedAt: new Date().toISOString() }
try {
  report.before = read(); report.after = { ...report.before, [name]: { invoke: 'false' } }
  await file.writeFile(JSON.stringify(report, null, 2)); assert.deepEqual(read(), report.before)
  const r = cloudApi('ModifyResourcePermission', { EnvId: env, ResourceType: 'function', Permission: 'CUSTOM', SecurityRule: JSON.stringify(report.after) })
  assert.equal(r.Data.Success, true); assert.deepEqual(read(), report.after); report.status = 'PASS'
} catch { report.status = 'FAIL'; process.exitCode = 1 }
await file.truncate(0); await file.write(JSON.stringify(report, null, 2), 0, 'utf8'); await file.close()
console.log(JSON.stringify({ status: report.status, functionName: name }))
