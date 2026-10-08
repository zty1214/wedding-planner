import cloudbase from '@cloudbase/js-sdk'
import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { cloudApi } from './cloudbase-cli.mjs'
import { PROBE_COLLECTIONS, documentKey } from '../../server/fusion/cloudBaseTransactionStore.ts'

const [configFile, fixtureReport, output, mode] = process.argv.slice(2)
if ((mode !== undefined && mode !== '--business') || !configFile || !fixtureReport || !output) throw Error('Provide source public env file, successful live fixture report, and new report path')
const config = parseEnv(await readFile(configFile, 'utf8'))
const env = config.VITE_CLOUDBASE_ENV_ID
if (env !== 'dev-d1gh3jw1gdf06af22') throw Error('UNEXPECTED_ENVIRONMENT')
const fixture = JSON.parse(await readFile(fixtureReport, 'utf8'))
if (fixture.status !== 'PASS' || fixture.env !== env || !fixture.fixtureProjectIds?.[0]) throw Error('VERIFIED_FIXTURE_REQUIRED')
if (mode === '--business' && fixture.functionName !== 'planner-fusion-gateway') throw Error('VERIFIED_BUSINESS_FIXTURE_REQUIRED')
const collections = mode === '--business' ? Object.fromEntries(['access', 'current', 'receipts', 'activity'].map(k => [k, 'planner_fusion_preprod_' + k])) : PROBE_COLLECTIONS
const report = { observedAt: new Date().toISOString(), env, checks: [], acl: [] }
let stage = 'acl-readback'
try {
  for (const name of Object.values(collections)) {
    const rule = cloudApi('DescribeDatabaseACL', { EnvId: env, CollectionName: name })
    report.acl.push({ collection: name, aclTag: rule.AclTag })
    if (rule.AclTag !== 'ADMINONLY') throw Error('ACL_NOT_ADMINONLY')
  }
  stage = 'anonymous-login'
  const app = cloudbase.init({ env, region: config.VITE_CLOUDBASE_REGION, accessKey: config.VITE_CLOUDBASE_PUBLISHABLE_KEY })
  const login = await app.auth().signInAnonymously()
  if (login.error) throw Error('ANONYMOUS_LOGIN_FAILED')
  report.anonymousLogin = 'PASS'
  const db = app.database()
  const absent = `fusion-permission-probe-${randomUUID()}`
  report.attemptedDocumentId = absent
  for (const name of Object.values(collections)) {
    let transportCodes = []
    function track(ref) {
      if (!ref.request?.send) return ref
      const send = ref.request.send.bind(ref.request)
      ref.request.send = async (...args) => {
        const response = await send(...args)
        const inspect = (value, depth = 0) => {
          if (!value || typeof value !== 'object' || depth > 4) return
          for (const name of ['code', 'errorCode', 'Code']) {
            if (typeof value[name] === 'string') transportCodes.push(value[name])
          }
          for (const name of ['data', 'response', 'error', 'Error']) inspect(value[name], depth + 1)
        }
        inspect(response)
        return response
      }
      return ref
    }
    const actions = {
      read: () => track(db.collection(name).doc(documentKey(fixture.fixtureProjectIds[0]))).get(),
      list: () => track(db.collection(name).limit(1)).get(),
      create: () => track(db.collection(name).doc(absent)).set({ probe: true }),
      update: () => track(db.collection(name).doc(absent)).update({ probe: true }),
      delete: () => track(db.collection(name).doc(absent)).remove(),
    }
    for (const [action, run] of Object.entries(actions)) {
      stage = `${name}:${action}`
      transportCodes = []
      let code = '', diagnostic = '', resultShape = null
      try { const result = await run(); code = result?.code ?? result?.error?.code ?? ''; resultShape = result && Object.fromEntries(Object.entries(result).map(([k,v]) => [k, typeof v])); }
      catch (error) {
        code = error?.code ?? ''
        const message = String(error?.message ?? '')
        diagnostic = message.replaceAll(config.VITE_CLOUDBASE_PUBLISHABLE_KEY, '[KEY]').replace(/https?:\/\/\S+/g, '[URL]').slice(0, 240)
      }
      const directCode = code
      code = [code, ...transportCodes].find(value => typeof value === 'string' && /PERMISSION_DENIED|ACCESS_DENIED|UNAUTHORIZED/i.test(value)) ?? code
      const denied = typeof code === 'string' && /PERMISSION_DENIED|ACCESS_DENIED|UNAUTHORIZED/i.test(code)
      report.checks.push({ collection: name, action, denied, code: typeof code === 'string' && /^[A-Za-z0-9_.-]+$/.test(code) ? code : 'UNCLASSIFIED', diagnostic, resultShape, sdkSurfaceOmittedDenial: denied && !directCode })
      if (!denied) throw Error('PERMISSION_DENIAL_NOT_PROVEN')
    }
  }
  report.status = 'PASS'
} catch {
  report.status = 'FAIL'; report.failedStage = stage; process.exitCode = 1
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report))
