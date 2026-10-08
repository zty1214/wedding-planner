import { usePendingInputGuard } from './PendingInputGuard'
import { useContext, useEffect, useRef, useState } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { openFieldDraftVault, fieldDraftCommand } from './fieldDrafts'
import type { FieldDraft, FieldDraftVault } from './fieldDrafts'
import { handoffForm } from './formHandoff'
import { ROOM_CAPACITY } from '../types'
import type { Guest, Room } from '../types'

/** Room-level dates and selected occupants are one private form and one frozen command. */
export default function FusionRoomArrangement({ room, guests, dates, suggestedDate, onClose }: {
  room: Room; guests: Guest[]; dates: string[]; suggestedDate?: string; onClose(): void
}) {
  const repo = useContext(RepositoryContext)!
  const initial = useRef(repo.getSnapshot().snapshot!)
  const [form, setForm] = useState({ guestIds: [] as string[], dates: room.stayDates ?? [] })
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const [recovered, setRecovered] = useState(false)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('正在读取本机草稿…')
  const [saved, setSaved] = useState<FieldDraft[]>([])
  const vault = useRef<FieldDraftVault | null>(null), active = useRef<FieldDraft | null>(null)
  const queue = useRef(Promise.resolve()), sequence = useRef(0), dirty = useRef(false), submitting = useRef(false), mounted = useRef(true)
  usePendingInputGuard(dirty)
  const search = useRef<HTMLInputElement>(null)
  const currentIds = guests.filter(g => g.roomId === room.id).map(g => g.id)
  const count = new Set([...currentIds, ...form.guestIds]).size
  useEffect(() => {
    let opened: FieldDraftVault | null = null
    mounted.current = true
    void openFieldDraftVault().then(async value => {
      opened = value
      if (!mounted.current) { value.close(); return }
      vault.current = value
      const rows = await value.list(repo.projectId)
      if (mounted.current) { setSaved(rows.filter(d => d.kind === 'roomArrangement' && d.entityId === room.id)); setReady(true); setMessage('选人及房间晚次后，一次确认保存。'); search.current?.focus() }
    }).catch(() => { if (mounted.current) setMessage('本机草稿暂不可用，不能安全保存。请重试。') })
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); void queue.current.finally(() => opened?.close()) }
  }, [repo, room.id])
  function change(next: typeof form) {
    if (!ready || recovered || submitting.current || active.current?.handoff) return
    setForm(next); dirty.current = true
    const number = ++sequence.current, snapshot = initial.current
    if (!active.current) active.current = { id: crypto.randomUUID(), projectId: repo.projectId, dataEpoch: snapshot.dataEpoch, entityId: room.id,
      kind: 'roomArrangement', entityRevision: snapshot.data.rooms[room.id].revision, revision: -1, value: '', updatedAt: new Date().toISOString() }
    const affected = [...new Set([...Object.values(snapshot.data.guests).filter(g => g.roomId === room.id).map(g => g.id), ...next.guestIds])]
    const revisions: Record<string, number> = { [`room:${room.id}`]: active.current.entityRevision, config: snapshot.data.config.revision }
    for (const id of affected) revisions[`guest:${id}`] = snapshot.data.guests[id]?.revision ?? -1
    const value = JSON.stringify({ guestIds: next.guestIds, dates: next.dates, expectedRevisions: revisions })
    setMessage('正在保存选择到本机…')
    queue.current = queue.current.then(async () => {
      const draft = active.current!
      try {
        active.current = await vault.current!.save({ ...draft, value, updatedAt: new Date().toISOString() }, draft.revision < 0 ? null : draft.revision)
        if (number === sequence.current) { dirty.current = false; if (mounted.current) setMessage('选择已保存在本机，尚未提交。') }
      } catch { if (mounted.current) setMessage('本机保存失败，选择保留在此页面；请重试本机保存。') }
    })
  }
  async function close() {
    if (submitting.current) return
    await queue.current
    if (dirty.current) { setMessage('选择未落盘，暂不能关闭。请先重试本机保存。'); return }
    onClose()
  }
  async function submit() {
    const reconciling = !!active.current?.handoff
    if (!ready || submitting.current || (!count && !reconciling)) return
    if (!reconciling && count > ROOM_CAPACITY[room.type] && !window.confirm(`共安排${count}人，超过建议${ROOM_CAPACITY[room.type]}人。仍要安排吗？`)) return
    if (!active.current) change(form)
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      const draft = active.current, snapshot = repo.getSnapshot().snapshot
      if (dirty.current || !draft || !snapshot) return
      const handed = await handoffForm(draft, repo, () => fieldDraftCommand(draft, snapshot),
        (value, revision) => vault.current!.save(value, revision), value => { active.current = value })
      if (!handed) { setMessage('未能完成整批保存，原请求已冻结。请核对当前安排和本机草稿后重试。'); return }
      const state = repo.getSnapshot()
      if (['conflict', 'forbidden', 'failed', 'resume_required'].includes(state.status)) {
        setMessage('整批安排尚未确认，原选择和原请求仍保留。请先处理顶部提示与本机命令草稿，再核对或重新编辑。')
        return
      }
      // Offline or unknown results keep the frozen private form until explicitly reconciled.
      if (state.status === 'synced' && state.pending === 0) await vault.current!.remove(handed)
      active.current = null; onClose()
    } catch { setMessage('未完成保存，选择与原请求仍在本机。可能有成员或房间被修改，请核对后重新编辑。') }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  async function recover(draft: FieldDraft) {
    if (submitting.current) return
    await queue.current
    if (dirty.current) { setMessage('当前选择未落盘，请先重试本机保存。'); return }
    try {
      const value = JSON.parse(draft.value) as typeof form
      if (!Array.isArray(value.guestIds) || !Array.isArray(value.dates)) throw Error('INVALID_INPUT')
      active.current = structuredClone(draft); setRecovered(true); setForm({ guestIds: value.guestIds, dates: value.dates }); setMessage('已载入原草稿；保留原代次和冲突校验，不会自动覆盖当前安排。')
    } catch { setMessage('草稿无法载入，请到本机草稿导出原内容。') }
  }
  const needle = query.trim().toLowerCase()
  const matches = guests.filter(g => `${g.name}\n${g.group}\n${g.phone ?? ''}`.toLowerCase().includes(needle))
  const visible = matches.filter(g => filter === 'all' || filter === 'confirmed' && g.attendance === 'confirmed' || filter === 'needed' && g.stayNeed === 'needed' || filter === 'unassigned' && !g.roomId)
  const frozen = !!active.current?.handoff
  const displayedDates = [...new Set([...dates, ...form.dates])].sort()
  const removedDates = form.dates.filter(date => !dates.includes(date))
  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h2>安排到「{room.label}」</h2><button disabled={busy} onClick={() => void close()}>关闭</button></div>
    <p className="text-sm">共安排 {count} 人。选择此房间使用的晚次，同房宾客共用这一安排。</p>
    {recovered && !frozen && <button disabled={busy} onClick={() => {
      const snapshot = repo.getSnapshot().snapshot
      if (!snapshot) return
      initial.current = snapshot; active.current = null; setRecovered(false)
      setMessage('将按最新安排另存新草稿；原草稿仍保留，可在本机草稿中核对。')
    }}>按最新安排另存新草稿</button>}
    <fieldset disabled={!ready || busy || frozen || recovered} className="space-y-2">
      <legend>房间住宿晚次</legend>
      <div className="flex flex-wrap gap-2">{displayedDates.map(date => <label key={date}><input type="checkbox" aria-label={date} checked={form.dates.includes(date)} onChange={() => change({ ...form, dates: form.dates.includes(date) ? form.dates.filter(d => d !== date) : [...form.dates, date].sort() })} /> {date}{!dates.includes(date) && <small>（已从项目日期移除）</small>}</label>)}</div>
      <div className="flex flex-wrap gap-2">{suggestedDate && <button onClick={() => change({ ...form, dates: [suggestedDate] })}>应用当前筛选晚次</button>}<button disabled={!dates.length} onClick={() => change({ ...form, dates: [...dates] })}>选择全部晚次</button><button onClick={() => change({ ...form, dates: [] })}>晚次待定</button></div>
      {removedDates.length > 0 && <p>原选择包含已移除日期：{removedDates.join('、')}。原请求仍保留；重新编辑时请取消这些日期或选择现有日期。</p>}
      {!dates.length && <p>尚未设置项目日期，可先保留晚次待定；关闭后在住宿页添加日期。</p>}
      {!form.dates.length && <p>晚次待定，不计入酒店每晚用房数量。</p>}
      <input ref={search} type="search" aria-label="搜索住宿宾客" placeholder="搜索姓名 / 分组 / 电话" value={query} onChange={e => setQuery(e.target.value)} className="w-full" />
      <select aria-label="住宿宾客筛选" value={filter} onChange={e => setFilter(e.target.value)}>{[['all', '全部'], ['confirmed', '已确认出席'], ['needed', '需要住宿'], ['unassigned', '未分房']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="max-h-64 overflow-auto">{visible.map(g => <label key={g.id} className="flex gap-2 items-center py-2 border-b"><input type="checkbox" checked={g.roomId === room.id || form.guestIds.includes(g.id)} disabled={g.roomId === room.id} onChange={() => change({ ...form, guestIds: form.guestIds.includes(g.id) ? form.guestIds.filter(id => id !== g.id) : [...form.guestIds, g.id] })} /><span>{g.name} · {g.group}<small className="block">{g.attendance === 'declined' ? '不出席，仍可安排住宿' : g.attendance === 'confirmed' ? '已确认出席' : '出席待确认'} · {g.stayNeed === 'needed' ? '需要住宿' : g.stayNeed === 'not_needed' ? '原不需要住宿' : '住宿待确认'} · {g.roomId === room.id ? '本房间已安排' : g.roomId ? '从其他房间移入，确认后更换原安排' : '未分房'}</small></span></label>)}</div>
      {!visible.length && <p>{matches.length ? '当前筛选无匹配，可切换到全部。' : '全名单没有匹配宾客。请核对搜索内容。'}</p>}
      {filter !== 'all' && <button onClick={() => setFilter('all')}>清除筛选</button>}
    </fieldset>
    <p role="status">{message}</p>
    {dirty.current && <button disabled={busy} onClick={() => change(form)}>重试本机保存</button>}
    {saved.length > 0 && <details><summary>恢复房间安排草稿（{saved.length}）</summary>{saved.map(d => <button key={d.id} disabled={busy} onClick={() => void recover(d)}>{new Date(d.updatedAt).toLocaleString('zh-CN')}</button>)}</details>}
    <button disabled={!ready || busy || (!count && !frozen)} onClick={() => void submit()}>{frozen ? '核对原提交' : '确认整批安排'}</button>
    <p className="text-xs">关闭保留本机选择；已新建的空房可在“全部日期”查看。顶部状态区分本机保存与云端同步。</p>
  </section>
}
