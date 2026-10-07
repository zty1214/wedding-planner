import PrivateDraftPanel from './PrivateDraftPanel'
import FusionFieldEditor from './FusionFieldEditor'
import ActivityCalendar from './ActivityCalendar'
import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { RepositoryContext } from './RepositoryContext'
import type { ProjectSnapshot } from './repository'
import type { Core } from './core'
import type { ProjectVersion, VersionMeta } from './history'
function ArrangementPreview({ core, label }: { core: Core; label: string }) {
  return <section className="min-w-0 space-y-2">
    <h3 className="font-semibold">{label}</h3>
    <p>标题：{core.config.title}；舞台：{core.config.mainStagePos ? `${core.config.mainStagePos.x}, ${core.config.mainStagePos.y}` : '未设置'}</p>
    <p>分组：{core.config.customGroups.join('、') || '无'}；可选晚次：{core.config.stayDates.join('、') || '无'}</p>
    <ul className="space-y-1">{core.tableOrder.map(id => { const t = core.tables[id]; return <li key={id}>{t.label}：{t.seats} 座，位置 ({t.x}, {t.y})，旋转 {t.rotation}°</li> })}</ul>
    <ul className="space-y-1">{core.roomOrder.map(id => { const r = core.rooms[id]; return <li key={id}>{r.label} · {r.type}{r.notes ? ` · ${r.notes}` : ''}</li> })}</ul>
    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="text-left">逐人安排（同名记录按各自位置列出）</caption>
      <thead><tr><th>宾客</th><th>出席 / 归属</th><th>座位</th><th>住宿</th></tr></thead>
      <tbody>{core.guestOrder.map(id => { const g = core.guests[id]; return <tr key={id} className="border-t">
        <td className="py-2">{g.name}<small className="block">{g.group}</small></td>
        <td>{{ pending: '待确认', confirmed: '已确认', declined: '不出席' }[g.attendance]} / {{ unset: '未设置', bride: '女方', groom: '男方', shared: '共同' }[g.side]}</td>
        <td>{g.tableId ? `${core.tables[g.tableId].label} · ${(g.seatIndex ?? 0) + 1} 号座` : '未排座'}</td>
        <td>{g.roomId ? `${core.rooms[g.roomId].label} · ${g.stayDates.join('、') || '晚次待定'}` : { pending: '需求待确认', needed: '待安排房间', not_needed: '不需要' }[g.stayNeed]}</td>
      </tr> })}</tbody></table></div>
  </section>
}
export default function HistoryPage() {
  const repo = useContext(RepositoryContext)
  if (!repo) throw Error('PROJECT_NOT_READY')
  const state = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<VersionMeta[]>([]), [cursor, setCursor] = useState<string | null>(null)
  const [against, setAgainst] = useState<ProjectSnapshot | null>(null), [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<ProjectVersion | null>(null), [reload, setReload] = useState(0)
  useEffect(() => {
    let stopped = false
    setBusy(true); setError('')
    void repo.readHistory(null, selectedDay).then(page => { if (!stopped) { setVersions(page.versions); setCursor(page.nextCursor) } })
      .catch(() => { if (!stopped) setError('版本列表读取失败，请稍后刷新。') })
      .finally(() => { if (!stopped) setBusy(false) })
    return () => { stopped = true }
  }, [repo, reload, selectedDay])
  async function more() {
    if (!cursor || busy) return
    setBusy(true); setError('')
    try { const page = await repo!.readHistory(cursor, selectedDay); setVersions(old => [...old, ...page.versions]); setCursor(page.nextCursor) }
    catch { setError('读取下一页失败，请重试。') } finally { setBusy(false) }
  }
  async function inspect(id: string) {
    setBusy(true); setPreview(null); setConfirming(false); setAgainst(repo!.getSnapshot().snapshot); setError('')
    try { setPreview(await repo!.readVersion(id)) } catch { setError('版本内容读取失败，请重试。') } finally { setBusy(false) }
  }
  async function restore() {
    const current = repo!.getSnapshot()
    if (!preview || !against || current.snapshot?.role !== 'management' || current.pending || current.status !== 'synced') return
    if (current.snapshot.dataEpoch !== against.dataEpoch) { setError('项目已恢复到其他版本，请重新预览。'); setConfirming(false); return }
    setBusy(true); setConfirming(false)
    await repo!.dispatch('version.restore', { id: preview.id }, { snapshot: against.snapshotRevision, notes: against.notesRevision ?? 0 })
    setBusy(false); setReload(v => v + 1)
  }
  function exportVersion(version: ProjectVersion) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(version, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `婚礼版本-${version.businessDate}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="h-full overflow-auto max-w-4xl mx-auto p-6 space-y-4">
    <h1 className="text-xl font-semibold">历史版本</h1>
    <p className="text-sm text-gray-600">手动版本保存已同步的宾客、座位布局、住宿和文本笔记，长期保留。当前不提供逐次修改日志。</p>
    <div className="flex gap-2"><FusionFieldEditor kind="version" entityId="current" label="版本名称" value="" submitLabel="保存当前版本" disabled={busy || state.status !== 'synced' || state.pending > 0} onSaved={() => setReload(v => v + 1)} />
      <button disabled={busy} onClick={() => setReload(v => v + 1)}>刷新</button></div>
    {state.status !== 'synced' && <p className="text-amber-800">请先确认所有草稿已同步，再保存共享版本。</p>}
    <ActivityCalendar selected={selectedDay} onSelect={day => { setSelectedDay(day); setPreview(null); setConfirming(false) }} reload={reload} />
    {selectedDay && <h2 className="font-semibold">{selectedDay} 的版本</h2>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {busy && <p role="status">正在处理…</p>}
    {!busy && !error && !versions.length && <p>尚未保存版本。</p>}
    {versions.map(v => <article key={v.id} className="border rounded bg-white p-4">
      <h2 className="font-semibold">{v.name}</h2><p className="text-sm text-gray-600">{new Date(v.capturedAt).toLocaleString('zh-CN')} · {v.counts.guests} 位宾客 · {v.counts.tables} 桌 · {v.counts.rooms} 间房 · {v.counts.notes} 篇笔记 · {v.expiresAt ? `保留至 ${new Date(v.expiresAt).toLocaleDateString('zh-CN')}` : '长期保留'}</p>
      <button disabled={busy || (!!v.expiresAt && Date.parse(v.expiresAt) <= Date.now())} className="text-rose-600 mt-2 disabled:opacity-40" onClick={() => void inspect(v.id)}>预览内容</button>
      {v.expiresAt && Date.parse(v.expiresAt) <= Date.now() && <p className="text-sm text-gray-500">已过保留期限，仅保留版本摘要，内容不再可用。</p>}
    </article>)}
    {cursor && <button disabled={busy} onClick={() => void more()}>加载更多版本</button>}
    {preview && <section className="border rounded bg-white p-4 space-y-3">
      <h2 className="font-semibold">版本预览：{preview.name}</h2>
      <button className="text-rose-600" onClick={() => exportVersion(preview)}>导出此版本数据</button>
      <p>项目：{preview.core.config.title}</p>
      <p>宾客：{preview.core.guestOrder.map(id => preview.core.guests[id].name).join('、') || '无'}</p>
      <p>桌子：{preview.core.tableOrder.map(id => preview.core.tables[id].label).join('、') || '无'}</p>
      <p>房间：{preview.core.roomOrder.map(id => preview.core.rooms[id].label).join('、') || '无'}；住宿晚次：{preview.core.config.stayDates.join('、') || '无'}</p>
      {preview.notes.map(n => <details key={n.id}><summary>{n.title || '无标题笔记'}（{n.category}）</summary><p className="whitespace-pre-wrap">{n.content}</p></details>)}
      {state.snapshot?.role === 'management' ? <button disabled={busy || state.status !== 'synced' || state.pending > 0 || (!!preview.expiresAt && Date.parse(preview.expiresAt) <= Date.now())} className="border border-red-500 text-red-700 rounded px-3 py-2" onClick={() => setConfirming(true)}>恢复整个项目到此版本</button> : <p className="text-sm text-gray-500">整项目恢复需要管理链接。</p>}
      {confirming && against && <div role="alertdialog" aria-label="确认恢复整个项目" className="border border-red-300 bg-red-50 p-4 space-y-3">
        <p>将用“{preview.name}”替换项目的全部宾客、桌子布局、住宿和文本笔记。</p>
        <p>宾客 {against.data.guestOrder.length} → {preview.counts.guests}，桌子 {against.data.tableOrder.length} → {preview.counts.tables}，房间 {against.data.roomOrder.length} → {preview.counts.rooms}，笔记 {against.notes?.length ?? 0} → {preview.counts.notes}。</p>
        <p>恢复前会保存当前安全版本，保留 90 天。协作链接不变；其他设备的旧草稿需人工核对。预览后若有新修改，本次恢复会被拒绝。</p>
        <PrivateDraftPanel key={repo.projectId} projectId={repo.projectId} dataEpoch={state.snapshot?.dataEpoch} />
        <button disabled={busy} className="bg-red-700 text-white px-3 py-2 rounded" onClick={() => void restore()}>确认替换并保留安全版本</button>
        <button disabled={busy} className="ml-3" onClick={() => setConfirming(false)}>取消</button>
      </div>}
      <div className="grid gap-6 lg:grid-cols-2 border-t pt-3">
        {against && <ArrangementPreview core={against.data} label="预览时的当前安排" />}
        <ArrangementPreview core={preview.core} label="恢复后的目标安排" />
      </div>
      <p className="text-sm text-gray-500">每日快照记录有已同步修改的日期，次日封存；自动和安全版本保留 90 天。</p>
    </section>}
  </main>
}
