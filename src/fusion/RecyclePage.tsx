import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { previewRestore } from './recycle'
import type { RecycleRecord } from './recycle'
import type { TextNote } from './notes'
import type { Core } from './core'

const labels: Record<string, string> = {
  'guest.clearStayNeed': '改为不需要住宿并清除安排', 'stayDate.remove': '删除住宿晚次', 'note.delete': '删除笔记', 'guest.delete': '删除宾客', 'table.deleteWithGuests': '删除桌子并移出宾客',
  'room.deleteWithAssignments': '删除房间并清除住宿安排', 'guest.clearRoom': '移出房间并清除晚次',
}
function describe(record: RecycleRecord) {
  return record.changes.map(c => {
    const before = c.before
    if (!before || typeof before !== 'object' || Array.isArray(before)) return c.id
    if (c.section === 'config') { const after = c.after; return Array.isArray(before.stayDates) && after && typeof after === 'object' && !Array.isArray(after) && Array.isArray(after.stayDates) ? before.stayDates.filter(date => !(after.stayDates as unknown[]).includes(date)).join('、') : '住宿晚次' }
    return String(before.name ?? before.title ?? before.label ?? c.id)
  }).join('、')
}
function details(record: RecycleRecord, core: Core) {
  const name = (section: 'tables' | 'rooms', id: unknown) => {
    if (typeof id !== 'string') return '未安排'
    const saved = record.changes.find(c => c.section === section && c.id === id)?.before
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? String(saved.label) : core[section][id]?.label ?? '原安排已不存在'
  }
  return record.changes.map(c => {
    const b = c.before
    if (!b || typeof b !== 'object' || Array.isArray(b)) return ''
    if (c.section === 'config') return `恢复删除前的住宿晚次列表：${Array.isArray(b.stayDates) ? b.stayDates.join('、') : ''}`
    if (c.section === 'notes') return `笔记“${b.title || '无标题'}”（${b.category}）：${b.content}`
    if (c.section === 'guests') return `${b.name}：桌位 ${name('tables', b.tableId)}${typeof b.seatIndex === 'number' ? `，第 ${b.seatIndex + 1} 座` : ''}；房间 ${name('rooms', b.roomId)}；住宿晚次 ${Array.isArray(b.stayDates) && b.stayDates.length ? b.stayDates.join('、') : '未选择'}。${b.phone ? `电话：${b.phone}。` : ''}${b.notes ? `备注：${b.notes}` : ''}`
    if (c.section === 'tables') return `桌子“${b.label}”：${b.seats} 个座位，恢复原来的位置和朝向。`
    return `房间“${b.label}”：${b.type}。${b.notes ?? ''}`
  })
}
function check(core: Core, record: RecycleRecord, notes: TextNote[] = []) {
  if (record.restoredAt || Date.parse(record.expiresAt) <= Date.now()) return { error: '此记录已恢复或已过保留期限。', revisions: {} }
  try { return { error: null, revisions: previewRestore(core, record, notes) } }
  catch { return { error: '当前安排已有变化，无法整体恢复。请保留此记录并核对宾客、座位与住宿安排。', revisions: {} } }
}
export default function RecyclePage() {
  const repo = useContext(RepositoryContext)
  if (!repo) throw Error('PROJECT_NOT_READY')
  const state = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  const [records, setRecords] = useState<RecycleRecord[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let stopped = false
    setLoading(true); setError('')
    void repo.readRecycle().then(result => { if (!stopped) setRecords(result.records) })
      .catch(() => { if (!stopped) setError('回收站读取失败，请检查网络或项目权限后重试。') })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [repo, state.snapshot?.dataEpoch, state.snapshot?.snapshotRevision, state.snapshot?.notesRevision, reload])
  async function restore(record: RecycleRecord) {
    const current = repo!.getSnapshot()
    if (current.status !== 'synced' || current.pending || !current.snapshot) return
    if (record.dataEpoch !== current.snapshot.dataEpoch) { setError('这是恢复前的记录，不能直接恢复。'); return }
    const preview = check(current.snapshot.data, record, current.snapshot.notes)
    if (preview.error) { setError(preview.error); return }
    if (!confirm(`恢复“${describe(record)}”及此记录中的原座位、住宿关联？提交时会再次检查冲突，不覆盖后续修改。`)) return
    await repo!.dispatch('recycle.restore', { id: record.id }, preview.revisions)
    setReload(value => value + 1)
  }
  function exportRecord(record: RecycleRecord) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `回收记录-${record.createdAt.slice(0, 10)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="planner-page h-full overflow-auto max-w-4xl mx-auto p-6 space-y-4">
    <h1 className="text-xl font-semibold">回收站</h1>
    <p className="text-sm text-gray-600">删除内容及相关安排保留 30 天。恢复前会核对当前数据，有冲突时不会抢占座位或覆盖新安排。</p>
    <button className="border rounded px-3 py-1" disabled={loading} onClick={() => setReload(value => value + 1)}>刷新回收站</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p role="status">正在读取回收站…</p> : !error && records.length === 0 ? <p>暂无可恢复记录。</p> : null}
    {!loading && !error && records.map(record => {
      const preview = record.dataEpoch !== state.snapshot?.dataEpoch ? { error: '来自恢复前的项目，仅可查看和导出，不能直接恢复。' } : state.snapshot ? check(state.snapshot.data, record, state.snapshot.notes) : { error: '请先读取项目。' }
      return <article key={`${record.dataEpoch}:${record.id}`} className="bg-white border rounded-xl p-4 space-y-2">
        <h2 className="font-semibold">{labels[record.type]}：{describe(record)}</h2>
        <p className="text-sm text-gray-500">删除时间：{new Date(record.createdAt).toLocaleString('zh-CN')}；保留至：{new Date(record.expiresAt).toLocaleString('zh-CN')}</p>
        <details><summary className="cursor-pointer text-sm">查看恢复内容</summary><ul className="text-sm space-y-2 p-3 bg-gray-50">{state.snapshot && details(record, state.snapshot.data).map((text, index) => <li key={index}>{text}</li>)}</ul></details>
        <button className="text-rose-600 text-sm" onClick={() => exportRecord(record)}>导出此记录</button>
        {preview.error && <p className="text-amber-800 text-sm">{preview.error}</p>}
        <button disabled={!!preview.error || state.status !== 'synced' || state.pending > 0} className="bg-rose-500 text-white rounded px-3 py-1 disabled:opacity-40" onClick={() => void restore(record)}>恢复此记录</button>
      </article>
    })}
  </main>
}
