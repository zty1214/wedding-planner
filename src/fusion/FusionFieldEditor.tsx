import { usePendingInputGuard } from './PendingInputGuard'
import { handoffForm } from './formHandoff'
import { useContext, useEffect, useRef, useState } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { fieldDraftCommand, fieldTarget, openFieldDraftVault } from './fieldDrafts'
import type { FieldDraft, FieldDraftVault, FieldKind } from './fieldDrafts'

/** Small shared fields are local drafts until explicitly saved, never submitted on blur. */
export default function FusionFieldEditor({ kind, entityId, label, value, disabled = false, submitLabel, onSaved }: {
  kind: FieldKind; entityId: string; label: string; value: string; disabled?: boolean; submitLabel?: string; onSaved?(): void
}) {
  const repo = useContext(RepositoryContext)!
  const submission = useRef<Promise<void> | null>(null)
  const root = useRef<HTMLDivElement>(null), vault = useRef<FieldDraftVault | null>(null)
  const active = useRef<FieldDraft | null>(null), queue = useRef(Promise.resolve())
  const dirty = useRef(false), submitting = useRef(false), mounted = useRef(false), sequence = useRef(0)
  usePendingInputGuard(dirty)
  const [text, setText] = useState<string | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<FieldDraft[]>([]), [message, setMessage] = useState('')
  const matches = (d: FieldDraft) => d.kind === kind && d.entityId === entityId
  useEffect(() => {
    let stopped = false, opened: FieldDraftVault | null = null
    mounted.current = true
    void openFieldDraftVault().then(async v => {
      if (stopped) { v.close(); return }
      opened = v; vault.current = v
      const records = await v.list(repo.projectId)
      if (!stopped) { setSaved(records.filter(d => d.kind === kind && d.entityId === entityId)); setReady(true) }
    }).catch(() => { if (!stopped) setMessage('本机草稿无法读取，暂不能编辑。') })
    const unload = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    const guard = (e: MouseEvent) => {
      if (dirty.current && e.target instanceof Element && !e.target.closest('[data-input-leave-guard]') && !root.current?.contains(e.target)) {
        e.preventDefault(); e.stopPropagation(); setMessage('输入尚未保存在本机，请先重试保存或复制留存。')
      }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', guard, true)
    return () => {
      stopped = true; mounted.current = false
      window.removeEventListener('beforeunload', unload); document.removeEventListener('click', guard, true)
      void Promise.allSettled([queue.current, submission.current]).then(() => { opened?.close(); if (vault.current === opened) vault.current = null })
    }
  }, [repo, kind, entityId])
  function persist(next: string) {
    if (!ready || submitting.current || active.current?.handoff) return
    setText(next)
    if (!active.current) {
      const snapshot = repo.getSnapshot().snapshot
      if (!snapshot) return
      active.current = { id: crypto.randomUUID(), projectId: repo.projectId, dataEpoch: snapshot.dataEpoch, kind, entityId,
        ...(kind === 'version' ? { entityNotesRevision: snapshot.notesRevision } : {}),
        entityRevision: fieldTarget(snapshot, kind, entityId).revision, value: next, revision: -1, updatedAt: new Date().toISOString() }
    }
    dirty.current = true; const number = ++sequence.current
    setMessage('正在保存到本机…')
    queue.current = queue.current.then(async () => {
      const original = active.current!
      try {
        active.current = await vault.current!.save({ ...original, value: next, updatedAt: new Date().toISOString() }, original.revision < 0 ? null : original.revision)
        if (number === sequence.current) {
          dirty.current = false
          if (mounted.current) setMessage('已保存在本机，尚未提交。')
        }
      } catch { if (mounted.current) setMessage('本机保存失败，请重试保存或复制输入留存。') }
    })
  }
  async function recover(draft?: FieldDraft) {
    if (submitting.current) return
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      if (dirty.current) { setMessage('当前输入尚未保存到本机，请先重试保存。'); return }
      const records = await vault.current!.list(repo.projectId)
      if (!draft) {
        active.current = null; setText(null); setSaved(records.filter(matches)); setMessage('原草稿仍在本机。现在显示当前共享值，可重新编辑。'); return
      }
      const latest = records.find(d => d.id === draft.id)
      if (!latest) { setSaved(records.filter(matches)); setMessage('这份草稿已在其他页面处理，请核对当前值。'); return }
      active.current = latest; setText(latest.value); setMessage(latest.handoff ? '原提交已冻结，可能已进入队列或同步成功。请点击核对原提交；新的修改请回到当前值编辑。' : '已载入本机草稿，请核对后保存；不会自动同步。')
    } finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  function submit() {
    if (submission.current) return submission.current
    const task = submitDraft().finally(() => { submission.current = null })
    submission.current = task
    return task
  }
  async function submitDraft() {
    if (submitting.current || text === null) return
    submitting.current = true; setBusy(true)
    try {
      await queue.current
      const draft = active.current, snapshot = repo.getSnapshot().snapshot
      if (dirty.current || !draft || !snapshot) return
      if (!draft.handoff) {
        const command = fieldDraftCommand(draft, snapshot)
        if ((await repo.readDrafts()).some(p => p.command.type === command.type && (['project', 'group', 'version'].includes(kind) || (p.command.payload as { id?: string }).id === entityId))) {
          setMessage('已有同一记录的待确认请求，请先处理本机命令草稿。'); return
        }
      }
      const handed = await handoffForm(draft, repo, () => fieldDraftCommand(draft, snapshot),
        (value, expected) => vault.current!.save(value, expected), value => { active.current = value })
      if (!handed) { setMessage('尚未完成交接，原提交已冻结；可点击核对原提交重试。'); return }
      await vault.current!.remove(handed)
      active.current = null
      if (mounted.current) { setText(null); setSaved((await vault.current!.list(repo.projectId)).filter(matches)); setMessage('请求已保存，同步结果请查看顶部状态。'); onSaved?.() }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error && ['CONFLICT', 'NOT_FOUND', 'PROJECT_REPLACED'].includes(error.message)
        ? '当前记录已修改、删除或恢复到另一版本。原草稿保留，请核对当前值后重新编辑。'
        : '未能完成，原草稿保留。请核对当前值及命令草稿，避免重复提交。')
    } finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  return <div ref={root} className="min-w-0 space-y-1">
    <div className="flex flex-wrap gap-1">
      <input maxLength={kind === 'version' ? 100 : undefined} aria-label={label} disabled={!ready || busy || disabled || !!active.current?.handoff} value={text ?? value} onChange={e => persist(e.target.value)} className="border-b w-36 max-w-full font-semibold text-sm" />
      {text !== null && <button disabled={busy || disabled || (!text.trim() && kind !== 'roomNotes')} onClick={() => void submit()} className="border rounded px-2 text-sm">{active.current?.handoff ? '核对原提交' : submitLabel ?? `保存${label}`}</button>}
      {text !== null && <button disabled={busy || disabled} onClick={() => void recover().catch(() => setMessage('草稿保留，请重试。'))} className="text-xs underline">保留草稿，回到当前值</button>}
      {dirty.current && <button disabled={busy || disabled} onClick={() => persist(text ?? value)} className="text-sm underline">重试本机保存</button>}
    </div>
    {text !== null && <p className="text-xs text-gray-500">{kind === 'group' || kind === 'version' ? '尚未提交的新名称' : `当前共享值：${value}`}</p>}
    {message && <p role="status" className="text-xs text-amber-800 max-w-xs">{message}</p>}
    {saved.length > 0 && <details><summary className="text-xs">恢复本机{label}草稿（{saved.length}）</summary>
      {saved.map(d => <button key={d.id} disabled={busy || disabled} className="block text-xs p-1" onClick={() => void recover(d).catch(() => setMessage('无法读取草稿，请重试。'))}>{d.value || '空内容'} · {new Date(d.updatedAt).toLocaleString('zh-CN')}</button>)}
    </details>}
  </div>
}
