import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { build } from 'rolldown'

/** Test harness only: loopback + Origin + per-process nonce; credentials never written to disk. */
export async function browserProbeRelay(config) {
  const { output } = await build({ input: 'scripts/fusion/browser-probe-client.mjs', platform: 'browser',
    output: { format: 'iife', minify: true }, write: false })
  const script = output.find(item => item.type === 'chunk').code
  const nonce = randomBytes(32).toString('hex')
  let ready, readyReject, waiting, done, sequence = 0
  const connected = new Promise((resolve, reject) => { ready = resolve; readyReject = reject })
  const queue = [], pending = new Map()
  const send = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    if (req.headers.host !== '127.0.0.1:4179') { res.writeHead(403).end(); return }
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><meta name="probe-session" content="${nonce}"><title>CloudBase 隔离浏览器验证</title><h1>CloudBase 隔离浏览器验证</h1><p>只使用虚构项目；不显示或持久保存项目凭证。</p><button>开始验证</button><pre id="status">等待开始</pre><script src="/client.js"></script>`); return
    }
    if (req.method === 'GET' && req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); return }
    if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:4179' || req.headers['x-probe-session'] !== nonce) { res.writeHead(403).end(); return }
    try {
      let raw = ''
      for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw Error('TOO_LARGE') }
      const body = JSON.parse(raw)
      if (req.url === '/init') { send(res, config); return }
      if (req.url === '/ready') { ready(); send(res, {}); return }
      if (req.url === '/next') {
        if (done) send(res, done)
        else if (queue.length) send(res, queue.shift())
        else if (!waiting) waiting = res
        else res.writeHead(409).end()
        return
      }
      if (req.url === '/result') {
        const p = pending.get(body.id)
        if (!p) { res.writeHead(409).end(); return }
        pending.delete(body.id); clearTimeout(p.timer); p.resolve(body.response); send(res, {}); return
      }
      res.writeHead(404).end()
    } catch { res.writeHead(400).end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4179, '127.0.0.1', resolve) })
  const timer = setTimeout(() => readyReject(Error('BROWSER_CONNECT_TIMEOUT')), 180000)
  console.log('Browser probe ready: http://127.0.0.1:4179')
  return {
    async ready() { try { await connected } finally { clearTimeout(timer) } },
    call(data) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(Error('BROWSER_CALL_TIMEOUT')) }, 30000)
        pending.set(id, { resolve, timer })
        if (waiting) { send(waiting, { id, data }); waiting = undefined }
        else queue.push({ id, data })
      })
    },
    finish(report) {
      clearTimeout(timer)
      done = { done: true, status: report.status, checks: report.checks.length }
      if (waiting) { send(waiting, done); waiting = undefined }
      // Allow the browser's final /next request to observe the summary, then close the local listener.
      setTimeout(() => { server.close(); server.closeAllConnections() }, 2000)
    },
  }
}
