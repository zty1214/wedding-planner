import FusionDialog from './FusionDialog'
import FusionFieldEditor from './FusionFieldEditor'
import FusionShell from './FusionShell'
import AccessPanel from './AccessPanel'
import type { ProjectTransport } from './repository'
import { refreshSignals } from './refreshSignals'
import ExportPanel from './ExportPanel'
import { ExportContext } from './ExportContext'
import DraftPanel from './DraftPanel'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Outlet, useParams } from 'react-router-dom'
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
type Session = { transport: ProjectTransport; repo: ReturnType<typeof projectRepository>; page: ReturnType<typeof createPageStore> }
function ProjectView({ session, projectId, notice }: { session: Session; projectId: string; notice: string }) {
  const state = useSyncExternalStore(session.repo.subscribe, session.repo.getSnapshot)
  const [exportKind, setExportKind] = useState<'guests' | 'rooms' | 'seating' | null>(null)
  const [showDrafts, setShowDrafts] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const editingPaused = !state.snapshot || ['loading', 'saving_local', 'syncing', 'resume_required', 'conflict', 'forbidden', 'failed'].includes(state.status)
  const errorLabels: Record<string, string> = { REJECTED_CURRENT_CONFIRMED: '修改未提交，已重新读取云端安排。', CONFIRMED_READ_FAILED: '修改未提交，暂未读到最新云端安排。', REQUEST_TOO_LARGE: '内容超出当前单次保存大小，请缩短或拆分；输入尚未提交。', INVALID_INPUT: '此操作当前不可用或输入不符合要求', CONFLICT: '数据已被更新，请先处理冲突', SEAT_OCCUPIED: '座位已被占用', NETWORK_ERROR: '暂时无法连接云端', EDITING_PAUSED: '请先处理未完成的保存', PROJECT_REPLACED: '项目已恢复到另一版本，旧草稿未提交' }
  return <RepositoryContext.Provider value={session.repo}><PageStoreContext.Provider value={session.page.store}><ExportContext.Provider value={setExportKind}>
    <FusionShell projectId={projectId} state={state.status}
      title={state.snapshot && <FusionFieldEditor kind="project" entityId="config" label="项目标题" value={state.snapshot.data.config.title} disabled={editingPaused} />}
      status={<>{labels[state.status]}{state.pending ? `（${state.pending} 项）` : ''}</>}
      resume={(['resume_required', 'unknown', 'local'].includes(state.status) || state.error === 'PROJECT_REPLACED') && <button className="border rounded px-3 py-1" onClick={() => void session.repo.resume()}>确认并继续同步</button>}
      actions={<>
        {state.snapshot?.role === 'management' && <button onClick={() => setShowAccess(value => !value)}>协作链接</button>}
        <button disabled={!state.snapshot} onClick={() => setExportKind('guests')}>导出表格</button>
        <button onClick={() => setShowDrafts(value => !value)}>查看本机草稿</button>
        <button onClick={() => void session.repo.refresh()}>刷新项目</button>
      </>}>
      {state.cacheError && <p role="alert" className="bg-amber-50 text-amber-900 px-4 py-2">{state.cacheError === 'CACHE_CLEAR_FAILED'
        ? '本机参考快照清理失败，页面已停止展示；请保留自己的草稿后清理此站点缓存。'
        : '云端读取已完成，但参考快照未能保存在本机。原有草稿仍保留，暂不能保证重开后的参考版本可用。'}</p>}
      {(notice || state.error) && <div role="alert" className="bg-amber-50 text-amber-900 px-4 py-2">{notice || errorLabels[state.error!] || '操作未完成，请保留本地草稿并重试。'}</div>}
      {['REJECTED_CURRENT_CONFIRMED', 'CONFIRMED_READ_FAILED'].includes(state.error ?? '') && <p className="bg-amber-50 text-amber-900 px-4 py-2">
        {state.error === 'CONFIRMED_READ_FAILED' ? '暂未读到最新云端安排，页面显示最近确认的副本。' : '页面显示云端确认的安排。'}
        被拒绝的修改及后续操作保留在本机草稿，后续发送已暂停；请查看草稿核对。
      </p>}
      {exportKind && <FusionDialog label="导出固定版本" onClose={() => setExportKind(null)}><ExportPanel key={exportKind} repo={session.repo} initialKind={exportKind} onClose={() => setExportKind(null)} /></FusionDialog>}
      {showAccess && state.snapshot?.role === 'management' && <FusionDialog label="协作链接管理" onClose={() => setShowAccess(false)}><AccessPanel projectId={projectId} transport={session.transport} repo={session.repo} onClose={() => setShowAccess(false)} /></FusionDialog>}
      {showDrafts && <FusionDialog label="本机草稿" onClose={() => setShowDrafts(false)}><DraftPanel repo={session.repo} onClose={() => setShowDrafts(false)} /></FusionDialog>}
      {!state.snapshot ? <p className="p-8">{labels[state.status]}。请使用包含访问凭证的项目链接。</p>
        : <fieldset disabled={editingPaused} className="flex-1 overflow-hidden min-h-0 min-w-0 w-full border-0 p-0 m-0" inert={editingPaused || undefined}><Outlet /></fieldset>}
    </FusionShell>
  </ExportContext.Provider></PageStoreContext.Provider></RepositoryContext.Provider>
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
      const stopRefresh = refreshSignals(() => repo.refresh())
      close = () => { stopRefresh(); page.unsubscribe(); repo.stop(); storage.close() }
      setSession({ repo, page, transport }); await repo.open()
    })().catch(error => {
      if (!stopped) setNotice(error instanceof Error && error.message === 'CONFIG' ? '新数据入口尚未配置 CloudBase 环境。' : '项目暂时无法打开。请检查链接凭证、网络和浏览器支持情况。')
    })
    return () => { stopped = true; close?.() }
  }, [projectId])
  // Route changes render before effect cleanup: never mount the previous project's session under a new URL.
  if (!session || session.repo.projectId !== projectId) return <div className="p-8" role="status">{notice || '正在打开项目…'}</div>
  return <ProjectView key={projectId} session={session} projectId={projectId} notice={notice} />
}
