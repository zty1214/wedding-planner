import { handoffForm } from './formHandoff'
import { NOTE_CATEGORIES } from '../types'
import { useContext, useEffect, useRef, useState } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { openNoteDraftVault } from './noteDrafts'
import type { NoteDraft, NoteDraftVault } from './noteDrafts'

export default function FusionNotesEditor({ category, noteId, onClose }: { category: string; noteId: string | null; onClose(): void }) {
  const repo = useContext(RepositoryContext)!
  const submission = useRef<Promise<void> | null>(null)
  const [form, setForm] = useState<NoteDraft>(() => {
    const snapshot = repo.getSnapshot().snapshot!, note = snapshot.notes?.find(n => n.id === noteId)
    return { id: crypto.randomUUID(), projectId: '', dataEpoch: snapshot.dataEpoch, noteId, entityId: noteId ?? crypto.randomUUID(), noteRevision: note?.revision ?? null,
      category: note?.category ?? category, title: note?.title ?? '', content: note?.content ?? '', revision: 0, updatedAt: new Date().toISOString() }
  })
  const [discarding, setDiscarding] = useState(false)
  const [ready, setReady] = useState(false)
  const unsaved = useRef(false)
  const [drafts, setDrafts] = useState<NoteDraft[]>([]), [status, setStatus] = useState('正在打开本机草稿'), [busy, setBusy] = useState(false)
  const vault = useRef<NoteDraftVault | null>(null), revision = useRef<number | null>(null), current = useRef(form)
  const queue = useRef<Promise<unknown>>(Promise.resolve()), sequence = useRef(0), alive = useRef(true)
  // The repository exposes only this project's drafts; the key is taken from its trusted session scope.
  useEffect(() => {
    alive.current = true
    let closed = false
    void openNoteDraftVault().then(async v => {
      if (closed) { v.close(); return }
      vault.current = v
      const values = await v.list(repo.projectId)
      if (!closed) { setDrafts(values); setReady(true); setStatus('输入内容后自动保存到本机，尚未共享') }
    }).catch(() => { if (!closed) setStatus('本机草稿暂不可用；请保留当前页面并复制正文留存。') })
    return () => { closed = true; alive.current = false; const v = vault.current; void Promise.allSettled([queue.current, submission.current]).then(() => v?.close()) }
  }, [repo])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved.current) { event.preventDefault(); event.returnValue = '' } }
    const guardNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!unsaved.current || !target?.closest('a[href], [data-note-editor-switch]')) return
      event.preventDefault(); event.stopPropagation()
      setStatus('最新输入尚未保存在本机，暂不能离开或切换笔记。请先另存草稿，或明确放弃当前表单。')
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guardNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', guardNavigation, true)
    }
  }, [])
  function update(patch: Partial<Pick<NoteDraft, 'title' | 'content' | 'category'>>, fork = false) {
    if (current.current.handoff) return
    const next = { ...current.current, ...patch, projectId: repo.projectId, updatedAt: new Date().toISOString(), ...(fork ? { id: crypto.randomUUID() } : {}) }
    current.current = next; setForm(next)
    const seq = ++sequence.current
    unsaved.current = true
    setStatus('正在保存本机笔记草稿…')
    queue.current = queue.current.then(async () => {
      if (!vault.current) throw Error('LOCAL_UNAVAILABLE')
      if (fork) revision.current = null
      const saved = await vault.current.save(next, revision.current)
      revision.current = saved.revision
      if (seq === sequence.current) {
        unsaved.current = false
        if (alive.current) setStatus('笔记草稿已保存在本机，尚未共享')
      }
    }).catch(() => { if (alive.current) setStatus('本机草稿保存失败或已被另一标签页修改。正文仍在输入框，可复制留存或另存草稿。') })
  }
  async function canLeave() {
    setBusy(true); await queue.current
    if (!unsaved.current) return true
    setStatus('最新输入尚未成功保存在本机，不能关闭或替换。请先另存草稿、复制留存，或明确放弃当前表单。')
    setBusy(false); return false
  }
  async function recover(draft: NoteDraft) {
    if (!await canLeave()) return
    revision.current = draft.revision; current.current = draft; setForm(draft)
    setStatus(draft.handoff ? '原提交已冻结，可能已进入队列或同步成功。请点击核对原提交；新的修改请关闭后重新打开当前笔记编辑。' : '已载入本机草稿，核对后点击保存才会共享'); setBusy(false)
  }
  async function discardForm() {
    setBusy(true); await queue.current
    try {
      if (revision.current !== null) await vault.current!.remove({ ...current.current, projectId: repo.projectId, revision: revision.current })
      onClose()
    } catch { setStatus('草稿已变化或无法删除，内容仍保留；请另存或重新查看。'); setDiscarding(false); setBusy(false) }
  }
  function publish() {
    if (submission.current) return submission.current
    const task = publishDraft().finally(() => { submission.current = null })
    submission.current = task
    return task
  }
  async function publishDraft() {
    setBusy(true); await queue.current
    if (unsaved.current) {
      setStatus('最新输入尚未成功保存在本机，暂不能发布。请先另存本机草稿或复制留存。'); setBusy(false); return
    }
    const value = { ...current.current, projectId: repo.projectId, revision: revision.current ?? -1 }
    try {
      const handed = await handoffForm(value, repo, () => {
        const snapshot = repo.getSnapshot().snapshot
        if (!snapshot || snapshot.dataEpoch !== value.dataEpoch) throw Error('PROJECT_REPLACED')
        if (value.noteId && snapshot.notes?.find(n => n.id === value.noteId)?.revision !== value.noteRevision) throw Error('CONFLICT')
        if (!value.noteId && snapshot.notes?.some(n => n.id === value.entityId)) throw Error('ALREADY_EXISTS')
        return { type: value.noteId ? 'note.update' : 'note.add',
          payload: { id: value.entityId, category: value.category, title: value.title.trim(), content: value.content.trim() },
          expectedRevisions: value.noteId ? { [`note:${value.noteId}`]: value.noteRevision! } : {}, dataEpoch: value.dataEpoch }
      }, (draft, expected) => vault.current!.save(draft, expected), draft => {
        current.current = draft; revision.current = draft.revision; setForm(draft)
      })
      if (!handed) { setStatus('尚未完成交接，原提交已冻结；请点击核对原提交重试。'); return }
      await vault.current!.remove(handed)
      onClose()
    } catch { setStatus('未能完成交接核对或清理，草稿仍保留。可重试核对；如云端已变化，请关闭后重新打开当前笔记编辑。') }
    finally { setBusy(false) }
  }

  return <section className="bg-white rounded-xl border p-4 mb-6 space-y-3" aria-label="笔记草稿编辑器">
    <p role="status" className="text-sm text-amber-800">{status}</p>
    {!!drafts.length && <details><summary>恢复本机笔记表单（{drafts.length}）</summary>
      {drafts.map(d => <button key={d.id} disabled={busy || !ready} onClick={() => void recover(d)} className="block text-left text-rose-600 py-1">{d.title || '无标题'} · {d.category} · {new Date(d.updatedAt).toLocaleString('zh-CN')}</button>)}
    </details>}
    <label className="block text-sm">分类 <select aria-label="笔记分类" disabled={busy || !ready || !!form.handoff} value={form.category} onChange={e => update({ category: e.target.value })} className="border rounded p-1">
      {[...new Set([...NOTE_CATEGORIES, form.category])].map(c => <option key={c}>{c}</option>)}
    </select></label>
    <input aria-label="笔记标题" disabled={busy || !ready || !!form.handoff} value={form.title} onChange={e => update({ title: e.target.value })} placeholder="标题（选填）" className="w-full border-b p-2" />
    <textarea aria-label="笔记正文" disabled={busy || !ready || !!form.handoff} value={form.content} onChange={e => update({ content: e.target.value })} rows={5} className="w-full border rounded p-2" placeholder="未发布的正文也会保存到本机" />
    <p className="text-sm text-gray-500">分类：{form.category}。关闭编辑器会保留已保存草稿；刷新后点“写笔记”可恢复。图片附件暂未接入。</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !ready || !!form.handoff} onClick={() => update({}, true)}>另存本机草稿</button>
      <button disabled={busy} onClick={() => void canLeave().then(ok => { if (ok) onClose() })}>关闭并保留草稿</button>
      <button disabled={busy || !ready} onClick={() => setDiscarding(true)}>放弃此表单草稿</button>
      <button disabled={busy || !ready || (!form.title.trim() && !form.content.trim())} onClick={() => void publish()} className="text-rose-700">{form.handoff ? '核对原提交' : form.noteId ? '保存修改' : '发布'}</button>
    </div>
    {discarding && <div role="alertdialog" aria-label="确认放弃笔记表单草稿" className="border border-red-300 p-3">
      <p>只放弃当前这份本机表单草稿，不撤销已经提交的操作或删除云端笔记。确认前可复制正文留存。</p>
      <button disabled={busy || !ready} onClick={() => void discardForm()} className="text-red-700 mr-4">确认放弃表单草稿</button>
      <button disabled={busy || !ready} onClick={() => setDiscarding(false)}>继续编辑</button>
    </div>}
  </section>
}
