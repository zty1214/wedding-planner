import PrivateDraftPanel from './PrivateDraftPanel'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConfirmedCopy, Pending, DraftArchive } from './outbox'
import { describePayload, describeCurrent } from './draftDescription'
import type { ProjectSnapshot, projectRepository } from './repository'
const states = { prepared: '已保存在本机，尚未发送', result_unknown: '云端结果待确认', conflict: '与当前安排冲突', forbidden: '凭证失效，草稿保留', failed: '操作被拒绝，草稿保留' }
const names: Record<string, string> = {
  'guest.add': '新增宾客', 'guest.update': '编辑宾客', 'guest.assign': '安排座位', 'guest.unassign': '移出座位', 'guest.swapSeats': '交换座位',
  'guest.assignRoom': '安排房间', 'guest.setStayDates': '调整晚次', 'guest.setStayNeed': '调整住宿需求', 'guest.clearRoom': '清除房间安排', 'guest.clearStayNeed': '清除住宿需求',
  'guest.delete': '删除宾客', 'table.add': '新增桌子', 'table.move': '移动桌子', 'table.update': '调整桌子', 'table.deleteWithGuests': '删除桌子并释放座位',
  'room.add': '新增房间', 'room.update': '编辑房间', 'room.deleteWithAssignments': '删除房间并清除安排', 'project.update': '编辑项目配置', 'group.add': '新增分组',
  'stayDate.add': '新增晚次', 'stayDate.remove': '删除晚次', 'note.add': '新增笔记', 'note.update': '编辑笔记', 'note.delete': '删除笔记',
  'version.save': '保存历史版本', 'version.restore': '恢复整个项目', 'recycle.restore': '恢复回收内容',
}
export default function DraftPanel({ repo, onClose }: { repo: ReturnType<typeof projectRepository>; onClose(): void }) {
  const view = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  const [drafts, setDrafts] = useState<Pending[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [base, setBase] = useState<ConfirmedCopy | null>(null)
  const [baseMessage, setBaseMessage] = useState('')
  const [comparison, setComparison] = useState<ProjectSnapshot | null>(null)
  const [comparisonMessage, setComparisonMessage] = useState('')
  async function loadCurrent() {
    setBusy(true); setComparison(null); setComparisonMessage('正在读取云端当前安排…')
    try { setComparison(await repo.readDraftCurrent()); setComparisonMessage('以下为本次读取的云端值；核对不会重发或修改草稿。') }
    catch { setComparisonMessage('无法确认当前访问权限或读取云端值；原草稿仍保留。') }
    finally { setBusy(false) }
  }
  const [archives, setArchives] = useState<DraftArchive[]>([])
  const [preserve, setPreserve] = useState(false)
  const [confirming, setConfirming] = useState(false), [result, setResult] = useState('')
  async function load() {
    setBusy(true); setError(''); setConfirming(false)
    try { setDrafts(await repo.readDrafts()); setArchives(await repo.readDraftArchives()) } catch { setError('无法读取本机草稿，请保留当前页面并重试。') } finally { setBusy(false) }
  }
  useEffect(() => {
    // Keep the reviewed discard batch frozen until the user leaves confirmation.
    if (confirming) return
    let stopped = false
    void Promise.all([repo.readDrafts(), repo.readDraftArchives()]).then(([value, retained]) => { if (!stopped) { setDrafts(value); setArchives(retained) } }).catch(() => { if (!stopped) setError('无法读取本机草稿，请重试。') })
    return () => { stopped = true }
  }, [repo, view.pending, view.status, confirming])
  async function loadBase() {
    setBase(null); setBaseMessage('正在核对访问权限并读取参考版本…')
    try {
      const copy = await repo.readDraftBase()
      setBase(copy); setBaseMessage(copy ? '' : '没有可用于当前数据代次的本机参考快照；原命令草稿仍保留。')
    } catch { setBaseMessage('尚未确认当前访问权限或无法读取参考版本；未展示本机共享缓存。') }
  }
  function download(items = drafts) {
    if (!items) return
    const blob = new Blob([JSON.stringify({ format: 'planner-local-drafts-v1', exportedAt: new Date().toISOString(), drafts: items }, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = '婚礼本机草稿.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function discard() {
    if (!drafts || busy) return
    setBusy(true); setError('')
    try {
      const result = await repo.discardDrafts(drafts, preserve)
      setDrafts([]); setConfirming(false)
      setResult(preserve ? `原草稿已保留在下方“重新编辑前留存”，不会再发送。请关闭此面板，在相应页面按当前安排重新编辑并保存；已同步的 ${result.alreadyCommitted} 项不会撤销。` : `已放弃 ${result.discarded} 项未提交草稿；另有 ${result.alreadyCommitted} 项已经在云端保存，只清除了本机待确认记录。`)
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      setError(code === 'RESULT_STILL_UNKNOWN' ? '仍有请求的云端结果无法确定，尚未放弃任何草稿。请先确认并继续同步，再重新查看。'
        : code === 'DRAFTS_CHANGED' ? '草稿已在其他标签页变化。尚未清除，请刷新列表后重新确认。'
        : code === 'FORBIDDEN' ? '请先使用有效项目链接重新授权，再核对云端结果；草稿仍在本机，可先导出。'
        : '无法安全核对或清除草稿，原草稿保留，请重试或先导出。')
      setConfirming(false)
    } finally { setBusy(false) }
  }
  return <section role="dialog" aria-label="本机草稿" className="border-b bg-amber-50 p-4 max-h-[65vh] overflow-auto space-y-3">
    <div className="flex flex-wrap gap-3 items-center"><h2 className="font-semibold">本机草稿{drafts ? `（${drafts.length} 项）` : ''}</h2>
      <button disabled={busy} onClick={() => void load()}>刷新列表</button><button disabled={busy || !drafts?.length} onClick={() => download()}>导出草稿</button><button disabled={busy} onClick={onClose}>关闭</button></div>
    <p className="text-sm">以下是已点击保存但尚未确认完成的操作。后续操作可能依赖前面的新增记录；放弃会处理本次列表的整组草稿。已同步修改不会撤销。</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}{result && <p role="status">{result}</p>}
    {!!drafts?.length && <div className="space-y-2">
      <button disabled={busy || repo.getSnapshot().status === 'forbidden'} onClick={() => void loadBase()} className="text-sm underline">核对编辑前参考快照</button>
      <button disabled={busy || view.status === 'forbidden'} onClick={() => void loadCurrent()} className="text-sm underline ml-3">核对云端当前值</button>
      {comparisonMessage && <p role="status" className="text-sm">{comparisonMessage}</p>}
      {baseMessage && <p role="status" className="text-sm">{baseMessage}</p>}
      {base && repo.getSnapshot().snapshot?.dataEpoch === base.snapshot.dataEpoch && repo.getSnapshot().status !== 'forbidden' && <details className="text-sm">
        <summary>编辑前参考快照 · 版本 {base.snapshot.snapshotRevision} · {new Date(base.capturedAt).toLocaleString('zh-CN')}</summary>
        <p>这是本机保存的云端确认版本，不包含后续草稿，也不代表最新安排。当前安排请查看主页面。</p>
        <p>宾客：{base.snapshot.data.guestOrder.map(id => base.snapshot.data.guests[id].name).join('、') || '无'}</p>
        <p>桌子：{base.snapshot.data.tableOrder.map(id => base.snapshot.data.tables[id].label).join('、') || '无'}</p>
        <p>房间：{base.snapshot.data.roomOrder.map(id => base.snapshot.data.rooms[id].label).join('、') || '无'}</p>
        <p>笔记：{base.snapshot.notes?.map(n => n.title).join('、') || '无'}</p>
      </details>}
    </div>}
    {drafts?.map((item, index) => <details key={`${item.command.dataEpoch}:${item.command.operationId}`} className="border rounded p-2 bg-white">
      <summary>{names[item.command.type] ?? item.command.type} · {states[item.status]}</summary>
      {drafts.slice(0, index).some(previous => ['conflict', 'failed', 'forbidden'].includes(previous.status)) && <p className="text-sm text-amber-800">前序操作未完成，本项发送已暂停。请连同前序草稿核对依赖，不能直接跳过前序发送。</p>}
      <p className="text-sm">{!view.snapshot ? '当前访问权限尚未确认，原草稿保留；暂不能核对它与当前安排的关系。' : item.command.dataEpoch === view.snapshot.dataEpoch ? '当前项目的草稿' : '来自其他数据代次，不能直接覆盖当前安排'}</p>
      <p className="font-medium text-sm">原草稿意图</p>
      <pre className="text-xs whitespace-pre-wrap break-all">{describePayload(item, view.snapshot)}</pre>
      {comparison && view.status !== 'forbidden' && view.snapshot?.dataEpoch === comparison.dataEpoch && <div className="border-t mt-2 pt-2">
        <p className="font-medium text-sm">本次读取的云端值 · 版本 {comparison.snapshotRevision} / 笔记 {comparison.notesRevision ?? '未知'}</p>
        <pre className="text-xs whitespace-pre-wrap break-all">{describeCurrent(item, comparison)}</pre>
      </div>}
    </details>)}
    {drafts?.length === 0 && <p>当前没有待确认命令。未点击保存的表单内容不在此列表。</p>}
    <PrivateDraftPanel key={repo.projectId} projectId={repo.projectId} dataEpoch={view.snapshot?.dataEpoch} />
    {archives.length > 0 && <div className="space-y-2 border-t pt-3">
      <h3 className="font-semibold">重新编辑前留存（仅本机）</h3>
      <p className="text-sm">以下是已退出发送队列的原始意图，不代表当前安排，不会自动恢复或重发。清除浏览器数据会删除这些留存。</p>
      {archives.map(archive => <details key={archive.id} className="border rounded p-2">
        <summary>{new Date(archive.savedAt).toLocaleString('zh-CN')} · {archive.drafts.length} 项原草稿</summary>
        <button onClick={() => download(archive.drafts)} className="underline text-sm">导出这组原草稿</button>
        {archive.drafts.map(item => <div key={`${item.command.dataEpoch}:${item.command.operationId}`} className="mt-2">
          <p className="font-medium text-sm">{names[item.command.type] ?? item.command.type}</p>
          <pre className="text-xs whitespace-pre-wrap break-all">{describePayload(item, view.snapshot)}</pre>
        </div>)}
      </details>)}
    </div>}
    {!!drafts?.length && !confirming && <button disabled={busy} onClick={() => { setPreserve(true); setConfirming(true) }} className="border rounded p-2 mr-3">保留原草稿，开始重新编辑</button>}
    {!!drafts?.length && !confirming && <button disabled={busy} onClick={() => { setPreserve(false); setConfirming(true) }} className="text-red-700 border rounded p-2">放弃本次列表中的草稿</button>}
    {confirming && <div role="alertdialog" aria-label={preserve ? '确认保留原草稿并重新编辑' : '确认放弃草稿'} className="border border-red-300 p-3 space-y-2">
      <p>{preserve ? `将这 ${drafts?.length} 项原草稿保留在本机，并退出发送队列。之后请逐项重新编辑和保存。` : `确认放弃这 ${drafts?.length} 项本机草稿？`}建议先导出留存。将重新读取当前云端安排，之后可重新编辑；不会撤销已同步操作。仍无法确认结果的请求会保留。</p>
      <button disabled={busy} onClick={() => void discard()} className="text-red-700 mr-4">{preserve ? '核对云端并保留，开始重新编辑' : '核对云端并确认放弃'}</button><button disabled={busy} onClick={() => setConfirming(false)}>取消</button>
    </div>}
  </section>
}
