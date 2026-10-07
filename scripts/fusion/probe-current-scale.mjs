// Bounded current-state acceptance through the real dev gateway; no admin writes or daily snapshots.
import assert from 'node:assert/strict'
import { readFile, open, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import clientSDK from '@cloudbase/js-sdk'
import * as XLSX from 'xlsx'
import { functionDetail } from './cloudbase-cli.mjs'
import { gatewayTransport } from '../../src/fusion/gatewayTransport.ts'
import { coreHandlers } from '../../server/fusion/coreHandlers.ts'
import { buildExportWorkbook } from '../../src/fusion/exportWorkbook.ts'
const [configPath, manifestPath, output] = process.argv.slice(2)
if (!configPath || !manifestPath || !output) throw Error('Provide config, manifest and fresh report path')
const config = parseEnv(await readFile(configPath, 'utf8')), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.env !== 'dev-d1gh3jw1gdf06af22' || config.VITE_CLOUDBASE_ENV_ID !== manifest.env || manifest.functionName !== 'planner-fusion-gateway-probe') throw Error('INVALID_TARGET')
await (await open(output, 'wx', 0o600)).close()
const report = { observedAt: new Date().toISOString(), env: manifest.env, functionName: manifest.functionName, manifestSha256: manifest.sha256, status: 'RUNNING', stage: 'deployment-readback', commands: 0, checks: [], timings: {} }
const save = () => writeFile(output, JSON.stringify(report, null, 2)), samples = {}
const started = performance.now()
let calls = 0
try {
 await save()
 const detail = functionDetail(manifest.env, manifest.functionName)
 assert.equal(detail.Status, 'Active')
 const vars = Object.fromEntries(detail.Environment.Variables.map(v => [v.Key, v.Value]))
 assert.equal(vars.FUSION_PROBE_PROJECTS, manifest.projects.join(',')); assert.equal(vars.LOG_EVENT_CONTEXT, 'false')
 const app = clientSDK.init({ env: manifest.env, region: 'ap-shanghai', accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY, persistence: 'none' })
 report.stage = 'login'; await save()
 assert.ok(!(await app.auth().signInAnonymously()).error)
 async function call(data) {
  if (++calls > 520 || performance.now() - started > 300000) throw Error('PROBE_BUDGET_EXCEEDED')
  let timer
  try {
   const result = await Promise.race([app.callFunction({ name: manifest.functionName, data }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('REQUEST_TIMEOUT')), 30000) })])
   if (result.code || typeof result.result?.ok !== 'boolean') throw Error('TRANSPORT_FAILED')
   return result.result
  } finally { clearTimeout(timer) }
 }
 const manager = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex')
 report.stage = 'create-new-fixture'; await save()
 const created = await call({ action: 'project.create', request: { requestId: randomUUID(), title: '纯虚构云端150人规模', collaborationSecret: secret, managementSecret: manager } })
 assert.equal(created.ok, true)
 const projectId = created.value.projectId; report.fixtureProjectId = projectId; await save()
 const client = gatewayTransport(projectId, manager, call), initial = await client.read(), epoch = initial.dataEpoch
 let expected = structuredClone(initial.data)
 const handlers = coreHandlers()
 async function send(type, payload, expectedRevisions = {}) {
  const command = { projectId, dataEpoch: epoch, operationId: randomUUID(), commandVersion: 1, type, payload, expectedRevisions }
  const start = performance.now(); const receipt = await client.execute(command)
  ;(samples[type] ??= []).push(Math.round(performance.now() - start)); report.commands++
  if (handlers.has(type)) expected = handlers.get(type).apply(expected, command)
  if (report.commands % 25 === 0) await save()
  return receipt
 }
 report.stage = 'create-current-arrangements'; await save()
 for (let i = 0; i < 15; i++) await send('table.add', { id: `t${i}`, label: `虚构桌${i+1}`, seats: 10, x: 150+(i%5)*250, y: 200+Math.floor(i/5)*250 })
 for (let i = 0; i < 30; i++) await send('room.add', { id: `r${i}`, label: String(i+1).padStart(3,'0'), type: '标间' })
 for (const date of ['2026-12-31','2027-01-01']) await send('stayDate.add', { date }, { config: expected.config.revision })
 for (let i = 0; i < 150; i++) {
  const id = `g${i}`, tableId = `t${Math.floor(i/10)}`
  await send('guest.add', { id, name: i === 0 ? '虚构小明' : i === 1 ? '虚构小明 2' : `虚构宾客${i+1}`, group: '纯虚构', phone: `00${String(i).padStart(9,'0')}` })
  await send('guest.assign', { id, tableId, seatIndex: i%10 }, { [`guest:${id}`]: expected.guests[id].revision, [`table:${tableId}`]: expected.tables[tableId].revision })
  if (i < 60) {
   const roomId = `r${Math.floor(i/2)}`
   await send('guest.assignRoom', { id, roomId }, { [`guest:${id}`]: expected.guests[id].revision, [`room:${roomId}`]: expected.rooms[roomId].revision })
   await send('guest.setStayDates', { id, dates: i%2 ? ['2027-01-01'] : ['2026-12-31','2027-01-01'] }, { [`guest:${id}`]: expected.guests[id].revision, config: expected.config.revision })
  }
 }
 for (let i = 0; i < 12; i++) await send('note.add', { id: `n${i}`, title: `虚构笔记${i}`, category: '其他', content: '纯虚构文本'.repeat(400) })
 report.stage = 'read-and-export'; await save()
 const readStart = performance.now(), snapshot = await client.read(); report.readDurationMs = Math.round(performance.now()-readStart)
 assert.deepEqual(snapshot.data, expected); assert.equal(snapshot.notes.length, 12)
 for (const note of snapshot.notes) assert.equal(note.content, '纯虚构文本'.repeat(400))
 report.snapshotJsonBytes = Buffer.byteLength(JSON.stringify(snapshot))
 for (const kind of ['guests','rooms']) {
  const artifact = buildExportWorkbook({ projectId, source:'confirmed', capturedAt:new Date().toISOString(), snapshot },kind)
  const bytes = XLSX.write(artifact.workbook,{type:'buffer',bookType:'xlsx'}), workbook=XLSX.read(bytes,{type:'buffer'})
  if(kind==='guests') {
   const rows=XLSX.utils.sheet_to_json(workbook.Sheets['宾客名单'],{header:1});assert.equal(rows.length,151)
   for(let i=0;i<150;i++){assert.equal(rows[i+1][0],expected.guests[`g${i}`].name);assert.equal(rows[i+1][1],expected.guests[`g${i}`].phone)}
  } else { const rows=XLSX.utils.sheet_to_json(workbook.Sheets['每晚用房']);assert.equal(rows[0]['当晚入住人数'],30);assert.equal(rows[1]['当晚入住人数'],60) }
  report.checks.push(`${kind}_export_roundtrip_pass`)
 }
 report.stage='manual-version';await save()
 await send('version.save',{name:'150人当前状态验收点'},{snapshot:snapshot.snapshotRevision,notes:snapshot.notesRevision})
 const history=await client.readHistory(), target=history.versions.find(v=>v.name==='150人当前状态验收点');assert.ok(target)
 const version=await client.readVersion(target.id);assert.deepEqual(version.core,expected);assert.equal(version.notes.length,12)
 report.checks.push('150_guests_15_tables_30_rooms_12_notes_exact_readback','manual_version_exact_core_and_note_count')
 report.status='PASS'
} catch { report.status='FAIL'; process.exitCode=1 }
finally {
 for(const [name,values]of Object.entries(samples)){values.sort((a,b)=>a-b);report.timings[name]={count:values.length,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.min(values.length-1,Math.floor(values.length*.95))],maxMs:values.at(-1)}}
 report.calls=calls;report.elapsedMs=Math.round(performance.now()-started);report.scope='Fresh synthetic project only; sequential Node SDK real gateway commands. JSON payload bytes are not database billed storage. No daily history, browser/mobile, concurrency load or SLA proof.'
 await save();console.log(JSON.stringify(report))
}
