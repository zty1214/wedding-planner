import cloudbase from '@cloudbase/js-sdk'
const status = document.querySelector('#status')
const session = document.querySelector('meta[name="probe-session"]').content
async function rpc(path, data) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Probe-Session': session }, body: JSON.stringify(data) })
  if (!r.ok) throw Error('LOCAL_RELAY_FAILED')
  return r.json()
}
document.querySelector('button').onclick = async event => {
  event.target.disabled = true
  try {
    const config = await rpc('/init', {})
    const app = cloudbase.init(config)
    const login = await app.auth({ persistence: 'none' }).signInAnonymously()
    if (login.error) throw Error('ANONYMOUS_LOGIN_FAILED')
    await rpc('/ready', {})
    status.textContent = '匿名登录通过，正在验证云函数…'
    let count = 0
    while (true) {
      const job = await rpc('/next', {})
      if (job.done) { status.textContent = job.status + '：' + job.checks + ' 组真实浏览器验证；请求 ' + count + ' 次'; break }
      void (async () => {
      let response
      try {
        const d = job.data
        if (d.__probeClientAction === 'storage.url') response = await app.getTempFileURL({ fileList: [d.fileID] })
        else if (d.__probeClientAction === 'storage.delete') response = await app.deleteFile({ fileList: [d.fileID] })
        else if (d.__probeClientAction === 'storage.upload') response = await app.uploadFile({ cloudPath: d.cloudPath,
          filePath: new Blob([Uint8Array.from(atob(d.base64), c => c.charCodeAt(0))], { type: 'image/png' }) })
        else response = await app.callFunction({ name: 'planner-fusion-gateway-probe', data: d })
      }
      catch (e) { response = { code: typeof e?.code === 'string' && /^[A-Za-z0-9_.-]+$/.test(e.code) ? e.code : 'CLIENT_ERROR' } }
      await rpc('/result', { id: job.id, response })
      count++
      status.textContent = '已完成云函数请求：' + count
      })().catch(() => { status.textContent = 'FAIL：本地验证通道失败' })
    }
  } catch { status.textContent = 'FAIL：浏览器登录或调用链路失败，详见脱敏报告' }
}
