import { useState, useSyncExternalStore, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { seatingExportModel } from './seatingExport'
import SeatingExport from './FrozenSeatingExport'
import { buildExportWorkbook } from './exportWorkbook'
import type { ExportSnapshot, projectRepository } from './repository'

export default function ExportPanel({ repo, initialKind, onClose }: { repo: ReturnType<typeof projectRepository>; initialKind: 'guests' | 'rooms' | 'seating'; onClose(): void }) {
  const state = useSyncExternalStore(repo.subscribe, repo.getSnapshot)
  const [kind, setKind] = useState(initialKind)
  const [value, setValue] = useState<ExportSnapshot | null>(() => { try { return repo.captureExport() } catch { return null } })
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState<ExportSnapshot | null>(null)
  const rendered = useCallback((message?: string, image?: string) => { setRendering(null); setError(message ?? ''); setPreview(image ?? null) }, [])
  const [capturing, setCapturing] = useState(false)
  async function capture(source: 'confirmed' | 'draft') {
    setPreview(null); setCapturing(true)
    try {
      let snapshot: ExportSnapshot
      try { snapshot = repo.captureExport(source) }
      catch (error) { if (source !== 'draft') throw error; snapshot = await repo.captureRecoveredDraft() }
      setValue(snapshot); setError('')
    }
    catch { setValue(null); setError(source === 'draft' ? '无法完整核对本机队列，可能存在冲突、旧版本草稿或网络故障，不能导出为完整安排。可在“查看本机草稿”中导出原操作，或选择云端已确认版本。' : '当前没有可导出的云端确认版本。') }
    finally { setCapturing(false) }
  }
  function download() {
    if (!value || !repo.getSnapshot().snapshot) return
    if (kind === 'seating') { setPreview(null); setRendering(value); setError(''); return }
    try { const result = buildExportWorkbook(value, kind); XLSX.writeFile(result.workbook, result.filename); setError('') }
    catch { setError('文件生成失败，请保留页面并重试。') }
  }
  if (!state.snapshot) return <section className="p-4 border-b"><p>当前无权访问或项目未加载，不能导出。</p><button onClick={onClose}>关闭</button></section>
  return <section role="dialog" aria-label="导出固定版本" className="p-4 border-b bg-blue-50 space-y-2">
    <div className="flex gap-4"><strong>导出安排</strong><button onClick={onClose}>关闭</button></div>
    <p className="text-sm">默认使用最近一次从云端读回的确认版本。打开此面板后内容固定，后续编辑不会改变本次文件。</p>
    <div className="flex flex-wrap gap-3"><button disabled={!!rendering || capturing} onClick={() => capture('confirmed')}>选取云端已确认版本</button><button disabled={!!rendering || capturing} onClick={() => capture('draft')}>明确选择本机草稿</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {value && <>
      <p>{value.snapshot.data.config.title} · {value.source === 'confirmed' ? '云端已确认' : '本机未同步草稿（已保存到本机队列的操作，不含未提交表单）'} · 核心版本 {value.snapshot.snapshotRevision}</p>
      {value.restoreTarget && <p>待恢复目标：{value.restoreTarget.name}。以下是目标安排，尚未执行恢复；版本号为恢复前核对的版本。</p>}
      <p className="text-xs">取样时间：{new Date(value.capturedAt).toLocaleString('zh-CN')}；{value.snapshot.data.guestOrder.length} 位宾客、{value.snapshot.data.roomOrder.length} 个房间。文件名标注来源及版本，表格属性或座位图侧栏也有标注。</p>
      <select disabled={!!rendering || capturing} aria-label="导出类型" value={kind} onChange={e => setKind(e.target.value as 'guests' | 'rooms' | 'seating')}><option value="guests">宾客名单</option><option value="rooms">住宿安排</option><option value="seating">座位图 PNG</option></select>
      <button className="ml-4 text-blue-800" disabled={!!rendering || capturing} onClick={download}>{kind === 'seating' ? '生成固定版本座位图' : '下载此固定版本'}</button>
    </>}
    {preview && value && <div><a className="text-blue-800 underline" href={preview} download={seatingExportModel(value).filename}>下载预览中的 PNG</a><p className="text-sm">本次座位图预览</p><img src={preview} alt="本次固定版本座位图" className="max-h-80 max-w-full object-contain" /></div>}
    {rendering && <><p role="status">正在生成固定版本座位图…</p><SeatingExport value={rendering} repo={repo} onDone={rendered} /></>}
  </section>
}
