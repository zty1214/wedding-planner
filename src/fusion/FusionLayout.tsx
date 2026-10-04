import { useEffect, useState, useSyncExternalStore } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { connectGateway } from './cloudClient'
import { PageStoreContext } from './PageContext'
import { createPageStore } from './pageStore'
import { openIndexedDbOutbox } from './indexedDbOutbox'
import { projectRepository } from './repository'
import type { Exclusive, SaveState } from './repository'
import { gatewayTransport } from './gatewayTransport'
import { RepositoryContext } from './RepositoryContext'

const labels: Record<SaveState, string> = {
  loading: '正在读取项目', synced: '已同步到云端', saving_local: '正在保存本地草稿', local: '草稿已保存在本机，尚未同步',
  syncing: '正在同步', unknown: '云端结果待确认，本地草稿保留', conflict: '冲突待处理，本地草稿保留',
  forbidden: '无权访问，本地草稿保留', local_error: '本地保存失败', failed: '操作未完成，本地草稿保留', resume_required: '发现本地草稿，请确认后继续同步',
}
type Session = { repo: ReturnType<typeof projectRepository>; page: ReturnType<typeof createPageStore> }
function ProjectView({ session, projectId, notice }: { session: Session; projectId: string; notice: string }) {
  const state = useSyncExternalStore(session.repo.subscribe, session.repo.getSnapshot)
  const [title, setTitle] = useState<string | null>(null)
  const editingPaused = !state.snapshot || ['loading', 'saving_local', 'syncing', 'resume_required', 'conflict', 'forbidden', 'failed'].includes(state.status)
  const errorLabels: Record<string, string> = { REQUEST_TOO_LARGE: '内容超出当前单次保存大小，请缩短或拆分；输入尚未提交。', INVALID_INPUT: '此操作当前不可用或输入不符合要求', CONFLICT: '数据已被更新，请先处理冲突', SEAT_OCCUPIED: '座位已被占用', NETWORK_ERROR: '暂时无法连接云端', EDITING_PAUSED: '请先处理未完成的保存', PROJECT_REPLACED: '项目已恢复到另一版本，旧草稿未提交' }
  return <RepositoryContext.Provider value={session.repo}><PageStoreContext.Provider value={session.page.store}>
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b px-4 py-3 flex gap-4 items-center flex-wrap">
        <input aria-label="项目标题" className="font-semibold w-36 border-b border-gray-200" value={title ?? state.snapshot?.data.config.title ?? ''} disabled={editingPaused}
          onChange={e => setTitle(e.target.value)} onBlur={async () => {
            const submitted = title
            if (!submitted?.trim()) return
            const saved = await session.page.store.getState().setProjectTitle(submitted.trim())
            if (saved !== false) setTitle(current => current === submitted ? null : current)
          }} />
        <a href="/fusion" className="text-sm text-gray-500">我的项目</a>
        <nav className="flex gap-3">{[['guests', '宾客名单'], ['seating', '座位安排'], ['stay', '住宿安排'], ['notes', '备婚笔记'], ['recycle', '回收站'], ['history', '历史版本']].map(([path, label]) =>
          <NavLink key={path} to={`/fusion/p/${projectId}/${path}`} className={({ isActive }) => isActive ? 'text-rose-600 font-semibold' : 'text-gray-600'}>{label}</NavLink>)}</nav>
        <span role="status" className="text-sm ml-auto">{labels[state.status]}{state.pending ? `（${state.pending} 项）` : ''}</span>
        {(['resume_required', 'unknown', 'local'].includes(state.status) || state.error === 'PROJECT_REPLACED') && <button className="border rounded px-3 py-1" onClick={() => void session.repo.resume()}>确认并继续同步</button>}
        <button className="border rounded px-3 py-1" onClick={() => void session.repo.refresh()}>刷新项目</button>
      </header>
      {(notice || state.error) && <div role="alert" className="bg-amber-50 text-amber-900 px-4 py-2">{notice || errorLabels[state.error!] || '操作未完成，请保留本地草稿并重试。'}</div>}
      {!state.snapshot ? <p className="p-8">{labels[state.status]}。请使用包含访问凭证的项目链接。</p>
        : <fieldset disabled={editingPaused} className="flex-1 overflow-hidden min-h-0 border-0 p-0 m-0" inert={editingPaused || undefined}><Outlet /></fieldset>}
    </div>
  </PageStoreContext.Provider></RepositoryContext.Provider>
}

/** Staged entry: no Supabase hook, no production project creation or implicit migration. */
export default function FusionLayout() {
  const { projectId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let stopped = false
    let close: (() => void) | undefined
    setSession(null); setNotice('')
    void (async () => {
      const env = import.meta.env.VITE_FUSION_ENV_ID, accessKey = import.meta.env.VITE_FUSION_PUBLISHABLE_KEY
      if (!env || !accessKey) throw Error('CONFIG')
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const incoming = hash.get('key')
      const storageKey = `planner-access:${projectId}`
      if (incoming && /^[a-f0-9]{64}$/.test(incoming)) {
        sessionStorage.setItem(storageKey, incoming)
        history.replaceState(history.state, '', window.location.pathname + window.location.search)
      }
      const secret = sessionStorage.getItem(storageKey)
      if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw Error('CREDENTIAL')
      if (!navigator.locks) throw Error('LOCKS')
      const invoke = await connectGateway()
      const storage = await openIndexedDbOutbox()
      if (stopped) { storage.close(); return }
      const transport = gatewayTransport(projectId, secret, invoke)
      const exclusive: Exclusive = (key, body) => navigator.locks.request(key, body)
      const repo = projectRepository(projectId, storage, transport, exclusive)
      const page = createPageStore(projectId, repo, setNotice)
      const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void repo.refresh() }, 10000)
      close = () => { clearInterval(poll); page.unsubscribe(); repo.stop(); storage.close() }
      setSession({ repo, page }); await repo.open()
    })().catch(error => {
      if (!stopped) setNotice(error instanceof Error && error.message === 'CONFIG' ? '新数据入口尚未配置 CloudBase 环境。' : '项目暂时无法打开。请检查链接凭证、网络和浏览器支持情况。')
    })
    return () => { stopped = true; close?.() }
  }, [projectId])
  if (!session) return <div className="p-8" role="status">{notice || '正在打开项目…'}</div>
  return <ProjectView session={session} projectId={projectId} notice={notice} />
}
