import * as XLSX from 'xlsx'
import { useContext, useRef, useState, useSyncExternalStore } from 'react'
import FusionDialog from './FusionDialog'
import { RepositoryContext } from './RepositoryContext'
import { MAX_GUEST_WORKBOOK_BYTES, readGuestRosterWorkbook } from './guestRosterWorkbook'
import { planGuestRoster } from './guestRoster'
import { buildGuestWorkbook } from '../utils/exportGuests'
import { assertGatewayRequestSize, CommandError, GUEST_REPLACE } from './protocol'
import type { Command } from './protocol'

type Preview = { command: Command; changes: ReturnType<typeof planGuestRoster> }

export default function GuestRosterImport() {
  const repo = useContext(RepositoryContext)!
  const state = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  const running = useRef(false)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null), [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState('')
  if (state.snapshot?.role !== 'management') return null
  const ready = state.status === 'synced' && state.pending === 0 && state.snapshot.notesRevision !== undefined
  const stale = !!preview && (preview.command.dataEpoch !== state.snapshot.dataEpoch
    || preview.command.expectedRevisions.snapshot !== state.snapshot.snapshotRevision || preview.command.expectedRevisions.notes !== state.snapshot.notesRevision)
  const changes = preview?.changes
  const changeCount = changes ? changes.added.length + changes.updated.length + changes.removed.length : 0

  async function load(file: File) {
    if (running.current || !ready) return
    running.current = true; setBusy(true); setPreview(null); setAcknowledged(false); setError(''); setStatus('')
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > MAX_GUEST_WORKBOOK_BYTES) throw Error('请选择不超过 2 MB 的 .xlsx 名单文件。')
      const rows = readGuestRosterWorkbook(await file.arrayBuffer())
      const current = repo.getSnapshot(), base = current.snapshot
      if (current.status !== 'synced' || current.pending || base?.role !== 'management' || base.notesRevision === undefined) throw Error('请先完成同步，再选择 Excel 文件。')
      const planned = planGuestRoster(base.data, rows)
      const command: Command = { type: GUEST_REPLACE, commandVersion: 1, operationId: crypto.randomUUID(), projectId: repo.projectId,
        dataEpoch: base.dataEpoch, payload: { rows }, expectedRevisions: { snapshot: base.snapshotRevision, notes: base.notesRevision } }
      assertGatewayRequestSize({ action: 'execute', projectId: repo.projectId, secret: '0'.repeat(64), command })
      setPreview({ command, changes: planned })
    } catch (e) {
      setError(e instanceof CommandError && e.code === 'REQUEST_TOO_LARGE' ? '名单内容太大，请缩短长备注后重试。'
        : e instanceof Error ? e.message : '无法读取名单。')
    } finally { running.current = false; setBusy(false) }
  }

  async function submit() {
    if (!preview || !ready || stale || !changeCount || running.current || (preview.changes.removed.length && !acknowledged)) return
    running.current = true; setBusy(true); setError(''); setStatus('')
    try {
      const { type, payload, expectedRevisions, dataEpoch, operationId } = preview.command
      const durable = await repo.dispatch(type, payload, expectedRevisions, dataEpoch, operationId)
      const latest = repo.getSnapshot()
      if (durable) setPreview(null)
      if (durable && latest.status === 'synced' && !latest.pending && latest.snapshot?.dataEpoch !== dataEpoch) {
        setStatus('名单已替换，保留宾客的座位和住宿安排未变。原名单可在历史版本里找回。')
      } else if (durable && latest.status === 'conflict') {
        setError('项目已有新修改，本次替换未完成。请核对当前安排及本机草稿，再重新预览。')
      } else if (durable) setStatus('替换请求已保存在本机，尚未确认云端结果。请查看同步状态和本机草稿，勿重复提交。')
      else setError('替换请求未能保存。请刷新并重新核对导入文件。')
    } finally { running.current = false; setBusy(false) }
  }

  function close() { if (!running.current) setOpen(false) }
  return <>
    <button type="button" className="rounded-lg border bg-white px-3 py-1.5 text-sm text-[#a44861]" onClick={() => { setPreview(null); setError(''); setStatus(''); setOpen(true) }}>导入名单</button>
    {open && <FusionDialog label="导入宾客名单" onClose={close}><section className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h2>导入宾客名单</h2><button type="button" disabled={busy} onClick={close}>关闭</button></div>
      <p>可编辑导出的名单后导回，或下载空白模板。保留表头和原宾客编号；新增宾客的编号留空，电话填文本。桌号和户名供核对，已有席位、住宿和户关系按系统保留。</p>
      <p className="text-sm text-gray-600">出席状态：待确认、已确认、不出席。住宿需求：待确认、需要住宿、不需要住宿。状态留空视为待确认；表里没有的宾客会在预览中列出。</p>
      <button type="button" onClick={() => XLSX.writeFile(buildGuestWorkbook([], [], true), '宾客名单导入模板.xlsx')}>下载空白模板</button>
      <label className="block text-sm">选择 Excel 名单
        <input aria-label="选择 Excel 名单" type="file" className="mt-1 block w-full" accept=".xlsx" disabled={busy || !ready} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void load(file)
        }} />
      </label>
      {!ready && !busy && <p className="text-sm">请先处理本机草稿并完成同步。</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {changes && <div className="space-y-2 border-t pt-3">
        <h3 className="font-semibold">替换预览</h3>
        <p>新增 {changes.added.length} 人 · 更新 {changes.updated.length} 人 · 移除 {changes.removed.length} 人</p>
        {changes.added.length > 0 && <details><summary>新增宾客</summary><ul className="list-disc pl-5">{changes.added.map((guest, index) => <li key={index}>{guest.name} · {guest.group || '未分组'}</li>)}</ul></details>}
        {changes.updated.length > 0 && <details><summary>更新宾客</summary><ul className="list-disc pl-5">{changes.updated.map(({ id, row }) => <li key={id}>{row.name} · {row.group || '未分组'}</li>)}</ul></details>}
        {changes.removed.length > 0 && <details open><summary>将从名单移除（同时释放这些宾客的座位和住宿）</summary>
          <ul className="max-h-40 overflow-auto list-disc pl-5">{changes.removed.map(guest => <li key={guest.id}>{guest.name} · {guest.group || '未分组'}{guest.tableId ? ' · 已排座' : ''}{guest.roomId ? ' · 已分房' : ''}</li>)}</ul>
        </details>}
        {stale && <p role="alert">项目已变化，请重新选择文件，核对新的预览。</p>}
        {!changeCount ? <p>名单没有变化，无需导入。</p> : <>
          <p className="text-sm">确认后会保留替换前的安全版本 90 天。尚未同步的旧草稿需要重新核对。</p>
          {changes.removed.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />我已核对将移除的宾客</label>}
          <button type="button" disabled={busy || !ready || stale || (changes.removed.length > 0 && !acknowledged)} onClick={() => void submit()}>确认替换宾客名单</button>
        </>}
      </div>}
    </section></FusionDialog>}
  </>
}
