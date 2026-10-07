import { handoffForm } from './formHandoff'
import { useContext, useEffect, useRef, useState } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { openGuestDraftVault, guestDraftCommand } from './guestDrafts'
import type { GuestDraft, GuestDraftVault } from './guestDrafts'

export default function FusionGuestForm({ groups, onAddGroup, guestId, onClose }: { groups: string[]; onAddGroup(): void; guestId?: string; onClose?(): void }) {
  const repo = useContext(RepositoryContext)!
  const submission = useRef<Promise<void> | null>(null)
  const initial = useRef(repo.getSnapshot().snapshot)
  const original = guestId ? initial.current?.data.guests[guestId] : undefined
  const vault = useRef<GuestDraftVault | null>(null)
  const active = useRef<GuestDraft | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const saveSequence = useRef(0)
  const failed = useRef(false), submitting = useRef(false)
  const [form, setForm] = useState({ name: original?.name ?? '', group: original?.group ?? groups[0] ?? '', phone: original?.phone ?? '' })
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<GuestDraft[]>([]), [message, setMessage] = useState('正在读取本机宾客草稿…')
  useEffect(() => {
    let stopped = false
    let opened: GuestDraftVault | null = null
    void openGuestDraftVault().then(async value => {
      if (stopped) { value.close(); return }
      opened = value; vault.current = value
      const drafts = await value.list(repo.projectId)
      if (!stopped) { setSaved(drafts); setReady(true); setMessage('') }
    }).catch(() => { if (!stopped) setMessage('无法读取本机草稿，请保留页面并重试。') })
    const warn = (e: BeforeUnloadEvent) => { if (failed.current) { e.preventDefault(); e.returnValue = '' } }
    const guard = (event: MouseEvent) => {
      if (failed.current && event.target instanceof Element && event.target.closest('a, [data-guest-form-switch]')) {
        event.preventDefault(); event.stopPropagation(); setMessage('输入尚未成功保存到本机，请先复制留存再离开。')
      }
    }
    document.addEventListener('click', guard, true)
    window.addEventListener('beforeunload', warn)
    return () => { stopped = true; window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guard, true); void Promise.allSettled([queue.current, submission.current]).then(() => { opened?.close(); if (vault.current === opened) vault.current = null }) }
  }, [repo])
  function change(patch: Partial<typeof form>) {
    if (!ready || submitting.current || active.current?.handoff) return
    const value = { ...form, ...patch }; setForm(value)
    const epoch = initial.current?.dataEpoch
    if (!epoch) return
    if (!active.current) active.current = { ...value, id: crypto.randomUUID(), entityId: guestId ?? crypto.randomUUID(), ...(guestId ? { guestRevision: original?.revision ?? -1 } : {}), projectId: repo.projectId, dataEpoch: epoch, revision: -1, updatedAt: new Date().toISOString() }
    const sequence = ++saveSequence.current
    failed.current = true; setMessage('正在保存宾客草稿到本机…')
    queue.current = queue.current.then(async () => {
      const current = active.current!
      try {
        active.current = await vault.current!.save({ ...current, ...value, updatedAt: new Date().toISOString() }, current.revision < 0 ? null : current.revision)
        if (sequence !== saveSequence.current) return
        failed.current = false; setMessage(current.guestRevision === undefined ? '宾客草稿已保存在本机，尚未添加到共享名单。' : '宾客修改已保存在本机，尚未更新共享名单。')
      } catch { failed.current = true; setMessage('本机保存失败，输入仍在此处；请复制留存，不要关闭或刷新。') }
    })
  }
  async function recover(draft?: GuestDraft) {
    if (submitting.current) return
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      if (failed.current) { setMessage('当前输入尚未成功保存，请先复制留存。'); return }
      setSaved(await vault.current!.list(repo.projectId))
      active.current = draft ? structuredClone(draft) : null
      setForm(draft ? { name: draft.name, group: draft.group, phone: draft.phone } : { name: '', group: groups[0] ?? '', phone: '' })
      setMessage(draft?.handoff ? '原提交已冻结，可能已进入队列或同步成功。请点击核对原提交；新的修改请重新打开当前记录编辑。' : draft ? '已载入本机草稿，请核对后提交；不会自动同步。' : '原草稿留在本机，可以开始填写另一位宾客。')
    } catch { setMessage('无法切换草稿，当前输入保留，请重试。') }
    finally { submitting.current = false; setBusy(false) }
  }
  function submit() {
    if (submission.current) return submission.current
    const task = submitDraft().finally(() => { submission.current = null })
    submission.current = task
    return task
  }
  async function submitDraft() {
    if (!ready || submitting.current || !form.name.trim()) return
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      const draft = active.current, snapshot = repo.getSnapshot().snapshot
      if (failed.current || !draft || !snapshot) return
      if (!draft.handoff && (await repo.readDrafts()).some(item => ['guest.add', 'guest.update'].includes(item.command.type) && (item.command.payload as { id?: string })?.id === draft.entityId)) { setMessage('这份草稿已有待确认请求，请先处理本机命令草稿。'); return }
      const handed = await handoffForm(draft, repo, () => guestDraftCommand(draft, snapshot),
        (value, expected) => vault.current!.save(value, expected), value => { active.current = value })
      if (!handed) { setMessage('尚未完成交接，原提交已冻结在本机；可点击核对原提交重试。'); return }
      try { await vault.current!.remove(handed) } catch { setMessage('请求已交接，但表单清理失败。请点击核对原提交；不会重复添加。'); return }
      active.current = null; setForm({ name: '', phone: '', group: form.group })
      setSaved(await vault.current!.list(repo.projectId)); setMessage('保存请求已保存；云端同步状态请查看顶部。'); onClose?.()
    } catch { setMessage('操作未完成，表单保留；请核对本机草稿与共享名单后重试。') } finally { submitting.current = false; setBusy(false) }
  }
  async function close() {
    if (submitting.current) return
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      if (failed.current) { setMessage('输入尚未保存在本机，请先复制留存。'); return }
      onClose?.()
    } finally { submitting.current = false; setBusy(false) }
  }
  return <div className="space-y-2">
    <div className="flex gap-3 flex-wrap">
      <input aria-label="宾客姓名" placeholder="宾客姓名" disabled={!ready || busy || !!active.current?.handoff} value={form.name} onChange={e => change({ name: e.target.value })} className="border rounded px-3 py-2" />
      <select aria-label="宾客分组" disabled={!ready || busy || !!active.current?.handoff} value={form.group} onChange={e => change({ group: e.target.value })} className="border rounded px-3 py-2">
        {[...new Set([...groups, form.group])].map(group => <option key={group}>{group}</option>)}
      </select>
      <input aria-label="宾客电话" placeholder="手机号（选填）" disabled={!ready || busy || !!active.current?.handoff} value={form.phone} onChange={e => change({ phone: e.target.value })} className="border rounded px-3 py-2" />
      <button disabled={!ready || busy || !form.name.trim()} onClick={() => void submit()} className="bg-rose-500 text-white rounded px-3 py-2">{active.current?.handoff ? '核对原提交' : (active.current ? active.current.guestRevision !== undefined : !!guestId) ? '保存修改' : '添加'}</button>
      <button disabled={busy} onClick={onAddGroup}>添加自定义类别</button>
      {onClose ? <button disabled={busy} onClick={() => void close()}>保留草稿并关闭编辑</button> : <button disabled={!ready || busy} onClick={() => void recover()}>保留草稿，填写另一位</button>}
    </div>
    {message && <p role="status" className="text-sm text-amber-800">{message}</p>}
    {saved.length > 0 && <details><summary>恢复本机宾客草稿（{saved.length}）</summary>{saved.map(draft => <button key={draft.id} disabled={busy || !ready} onClick={() => void recover(draft)} className="block p-2 text-left">{draft.name || '未命名宾客'} · {new Date(draft.updatedAt).toLocaleString('zh-CN')}</button>)}</details>}
  </div>
}
