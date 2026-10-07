import { useState } from 'react'
import { readPrivateDraftInventory } from './privateDraftInventory'
import type { PrivateDraftInventory } from './privateDraftInventory'

export default function PrivateDraftPanel({ projectId, dataEpoch }: { projectId: string; dataEpoch?: string }) {
  const [value, setValue] = useState<PrivateDraftInventory | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function read() {
    setBusy(true); setError(''); setValue(null)
    try { setValue(await readPrivateDraftInventory(projectId)) }
    catch { setError('无法完整读取本机表单草稿，请保留浏览器数据并重试；没有删除或修改草稿。') }
    finally { setBusy(false) }
  }
  function download() {
    if (!value || value.projectId !== projectId) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = '婚礼本机表单草稿.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const current = value?.projectId === projectId ? value : null
  const rows = current ? [
    ...current.fieldDrafts.map(d => ({ ...d, label: ({ project: '项目标题', table: '桌名', room: '房号', group: '类别', version: '版本名称' })[d.kind], text: d.value })),
    ...current.guestDrafts.map(d => ({ ...d, label: '宾客表单', text: `姓名：${d.name}\n分组：${d.group}\n电话：${d.phone}` })),
    ...current.noteDrafts.map(d => ({ ...d, label: '笔记表单', text: `${d.category} · ${d.title}\n${d.content}` })),
  ] : []
  return <section className="border rounded p-3 space-y-2">
    <h3 className="font-semibold">未提交的表单草稿（仅本机）</h3>
    <p className="text-sm">包括旧版本及已删除记录的输入。恢复项目不会清除这些草稿，也不会自动提交它们；可在此查看、导出后人工核对。这里不包含尚未成功写入本机的输入。</p>
    <button disabled={busy} className="underline" onClick={() => void read()}>{busy ? '正在读取表单草稿…' : '读取全部本机表单草稿'}</button>
    {error && <p role="alert">{error}</p>}
    {current && <><p>{rows.length} 项；这是本次读取的副本，其他页面继续编辑后请重新读取。</p>
      <button disabled={!rows.length} className="underline" onClick={download}>导出本次表单草稿</button>
      {rows.map(row => <details key={`${row.label}:${row.id}`}><summary>{row.label} · {dataEpoch ? row.dataEpoch === dataEpoch ? '当前数据代次' : '旧数据代次，需人工核对' : '当前数据代次尚未确认'} · {new Date(row.updatedAt).toLocaleString('zh-CN')}</summary><pre className="text-xs whitespace-pre-wrap break-all">{row.text}</pre></details>)}
    </>}
  </section>
}
