import { useEffect, useRef, useState } from 'react'
import { newRotation, openRotationVault, submitRotation } from './accessRotation'
import type { RotationRequest, RotationVault } from './accessRotation'
import type { ProjectTransport, projectRepository } from './repository'

export default function AccessPanel({ projectId, transport, repo, onClose }: {
  projectId: string; transport: ProjectTransport; repo: ReturnType<typeof projectRepository>; onClose(): void
}) {
  const vault = useRef<RotationVault | null>(null)
  const active = useRef(false)
  const [requests, setRequests] = useState<RotationRequest[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('正在读取本机链接记录…')
  const [link, setLink] = useState('')
  useEffect(() => {
    let stopped = false
    active.current = true
    void openRotationVault().then(async opened => {
      if (stopped) { opened.close(); return }
      vault.current = opened
      const saved = await opened.list(projectId)
      if (!stopped) { setRequests(saved); setMessage('更换后旧协作链接将失效，包括已经打开的页面；未同步草稿会保留在原设备。'); setBusy(false) }
    }).catch(() => { if (!stopped) { setMessage('本机链接记录无法读取，暂不能更换。'); setBusy(false) } })
    return () => { stopped = true; active.current = false; vault.current?.close(); vault.current = null }
  }, [projectId])
  async function run(body: () => Promise<void>) {
    if (busy || !vault.current) return
    setBusy(true); setLink('')
    try { await body() } catch (error) {
      if (active.current) setMessage(error instanceof Error && error.message === 'ROTATION_SUPERSEDED'
        ? '这条链接已被后续更换作废，请核对其他本机记录。'
        : '未能确认完成。已保存的链接记录仍在本机；请保留记录，稍后核对原请求。若提示冲突或链接已失效，请刷新项目。')
    } finally { if (active.current) setBusy(false) }
  }
  async function prepare() {
    const snapshot = repo.getSnapshot().snapshot
    if (!snapshot || snapshot.role !== 'management' || !transport.readAccess) throw Error('UNAVAILABLE')
    const access = await transport.readAccess()
    const request = await newRotation(projectId, snapshot.dataEpoch, access.revision)
    await vault.current!.save(request)
    const saved = await vault.current!.list(projectId)
    if (active.current) { setRequests(saved); setMessage('新链接已安全保存在本机，尚未更换。点击对应记录的“确认更换或核对原请求”后，旧链接才可能失效。') }
  }
  async function confirm(request: RotationRequest, copy: boolean) {
    if (repo.getSnapshot().snapshot?.role !== 'management') throw Error('FORBIDDEN')
    const result = await submitRotation(vault.current!, transport, request)
    if (!active.current) return
    const url = new URL(`/fusion/p/${encodeURIComponent(projectId)}/guests`, window.location.origin)
    url.hash = new URLSearchParams({ key: result.secret }).toString()
    setLink(url.href); setMessage(`已向云端确认协作链接有效（访问版本 ${result.revision}）。请仅分享给自己人。`)
    if (copy) {
      try { await navigator.clipboard.writeText(url.href); if (active.current) setMessage('已重新核对并复制有效协作链接。') }
      catch { if (active.current) setMessage('自动复制失败，请从下方手动复制已确认的链接。') }
    }
  }
  return <section className="border-b bg-white p-4 space-y-3" aria-label="协作链接管理">
    <div className="flex justify-between"><h2 className="font-semibold">协作链接管理</h2><button onClick={onClose}>关闭</button></div>
    <p role="status" className="text-sm text-amber-900">{message}</p>
    <p className="text-sm text-gray-500">本机记录包含私密链接，不会放入表格、版本或业务草稿导出。清除浏览器数据会删除这些本机记录。</p>
    <button disabled={busy || !vault.current} className="border rounded px-3 py-1" onClick={() => void run(prepare)}>准备新协作链接</button>
    {requests.map((request, index) => <div key={request.command.operationId} className="flex gap-3 items-center flex-wrap">
      <span>本机记录 {index + 1}（基于访问版本 {request.command.expectedRevisions.access}）</span>
      <button disabled={busy} className="border rounded px-3 py-1" onClick={() => void run(() => confirm(request, false))}>确认更换或核对原请求</button>
      <button disabled={busy} className="border rounded px-3 py-1" onClick={() => void run(() => confirm(request, true))}>确认更换并复制链接</button>
    </div>)}
    {link && <label className="block text-sm">本次核对有效的协作链接<input className="block border rounded p-2 w-full" aria-label="已确认的协作链接" readOnly value={link} onFocus={e => e.target.select()} /></label>}
  </section>
}
