import { useEffect, useState } from 'react'
import { newCreation, projectLinks, creationProjectId } from './projectCreation'
import type { CreationRequest } from './projectCreation'
import { openCreationVault, submitCreation } from './creationVault'
import type { CreationVault, SavedCreation } from './creationVault'
import { connectGateway } from './cloudClient'

export default function ProjectsPage() {
  const [vault, setVault] = useState<CreationVault | null>(null), [entries, setEntries] = useState<SavedCreation[]>([])
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    let stopped = false, owned: CreationVault | undefined
    void openCreationVault().then(async value => {
      owned = value
      if (stopped) { value.close(); return }
      setVault(value); setEntries(await value.list())
    }).catch(() => setMessage('本机无法保存项目链接，请检查浏览器存储空间。'))
    return () => { stopped = true; owned?.close() }
  }, [])
  async function create(request?: CreationRequest) {
    if (!vault || busy) return
    setBusy(true); setMessage('正在保存本机创建请求…')
    try {
      const input = request ?? newCreation(title.trim())
      await vault.save(input); setEntries(await vault.list()); setMessage('正在创建项目…')
      const invoke = await connectGateway()
      await submitCreation(vault, invoke, input)
      setEntries(await vault.list()); setTitle(''); setMessage('项目已创建。请分别保管协作链接和管理链接。')
    } catch (e) {
      setMessage(e instanceof Error && e.message === 'RATE_LIMITED' ? '今日开发环境创建额度已用完，请保留本机请求后重试。' : '尚未确认创建成功。已保存的请求可点击重试，不要重复新建。')
    } finally { setBusy(false) }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setMessage('链接已复制。管理链接只交给项目负责人保管。') } catch { setMessage('复制失败，请检查浏览器剪贴板权限。') }
  }
  return <main className="max-w-3xl mx-auto p-6 space-y-5">
    <h1 className="text-xl font-semibold">我的备婚项目</h1>
    <p className="text-gray-600">每个项目的数据独立。协作链接供家人一起编辑，管理链接由负责人保管。</p>
    <div className="flex gap-3"><input aria-label="新项目名称" className="border rounded px-3 py-2 flex-1" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} />
      <button className="bg-rose-500 text-white rounded px-4 disabled:opacity-40" disabled={!vault || busy || !title.trim() || entries.some(e => !e.confirmed)} onClick={() => void create()}>新建独立项目</button></div>
    <p role="status">{message}</p>
    {entries.map(entry => {
      const links = projectLinks(window.location.origin, entry.request)
      return <section key={entry.request.requestId} className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">{entry.request.title}</h2>
        {!entry.confirmed ? <button disabled={busy} onClick={() => void create(entry.request)}>重试并确认创建结果</button> : <div className="flex flex-wrap gap-4">
          <button className="text-rose-600" onClick={() => {
            const projectId = creationProjectId(entry.request.requestId)
            sessionStorage.setItem(`planner-access:${projectId}`, entry.request.managementSecret)
            window.location.assign(`/fusion/p/${projectId}/seating`)
          }}>打开项目</button>
          <button onClick={() => void copy(links.collaboration)}>复制协作链接</button>
          <button onClick={() => void copy(links.management)}>复制管理链接</button>
        </div>}
      </section>
    })}
    <p className="text-sm text-gray-500">链接保存在当前浏览器。请另行保存管理链接；清除浏览器数据会清除本机记录。</p>
  </main>
}
