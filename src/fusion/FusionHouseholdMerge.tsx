import { useRef, useState } from 'react'
import type { Guest, Table } from '../types'
import { MAX_GUEST_ROWS } from './guestRoster'
import FusionDialog from './FusionDialog'

export default function FusionHouseholdMerge({ rows, tables, existing, onClose, onSave }: {
  rows: Map<string, Guest[]>; tables: Table[]; existing?: string; onClose(): void
  onSave(name: string, guestIds: string[], id?: string): Promise<boolean>
}) {
  const [selected, setSelected] = useState<string[]>(existing ? [existing] : [])
  const [query, setQuery] = useState('')
  const [editedName, setEditedName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const title = existing ? '编辑整户' : '合并成一户'
  const options = [...rows].map(([key, members]) => ({ key, members, id: members[0].household?.id, name: members[0].household?.name ?? members[0].name }))
  const selectedRows = selected.flatMap(key => options.find(row => row.key === key) ?? [])
  const members = selectedRows.flatMap(row => row.members)
  const name = editedName ?? (existing ? selectedRows[0]?.name ?? '' : selectedRows.map(row => row.name).join('、'))
  const target = selectedRows.find(row => row.id)?.id
  const needle = query.trim().toLowerCase()
  const shown = options.filter(row => row.key === existing || [row.name, ...row.members.map(guest => guest.name)].some(value => value.toLowerCase().includes(needle)))
  const valid = selected.length === selectedRows.length && (existing ? selectedRows.some(row => row.key === existing) : selectedRows.length >= 2)
    && members.length <= MAX_GUEST_ROWS && !!name.trim()
  async function save() {
    if (!valid || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (await onSave(name.trim(), members.map(guest => guest.id), target)) onClose()
      else setError('保存未完成，请刷新名单后核对所选成员。')
    } catch {
      setError('保存未完成，请查看顶部同步状态。')
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }
  return <FusionDialog label={title} onClose={() => { if (!submitting.current) onClose() }}>
    <form className="space-y-3 p-4 sm:p-6" onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 className="text-base font-semibold">{title}</h2>
      <label className="grid gap-1 text-sm">户名
        <input className="min-w-0 border" placeholder="填写户名" value={name} disabled={busy} onChange={event => setEditedName(event.target.value)} />
      </label>
      <input autoFocus type="search" aria-label="搜索待合户宾客" className="w-full border" placeholder="搜索宾客或户名" value={query}
        disabled={busy} onChange={event => setQuery(event.target.value)} />
      <ul className="max-h-[32dvh] overflow-y-auto rounded-lg border border-gray-200">
        {shown.map(row => <li key={row.key} className="border-b border-gray-100 last:border-b-0">
          <label className="flex items-center gap-2 px-3 py-2 text-sm">
            <input type="checkbox" checked={selected.includes(row.key)} disabled={busy || row.key === existing}
              aria-label={row.id ? `${row.name}（${row.members.length} 人）` : row.name}
              onChange={() => setSelected(current => current.includes(row.key) ? current.filter(key => key !== row.key) : [...current, row.key])} />
            <span>{row.name}{row.id && `（${row.members.length} 人）`}</span>
            <span className="text-xs text-gray-500">
              {row.id ? row.members.map(member => member.name).join('、') : [row.members[0].group,
                tables.find(table => table.id === row.members[0].tableId)?.label,
                row.members[0].seatIndex === null ? '' : `${row.members[0].seatIndex + 1} 号位`].filter(Boolean).join(' · ')}
            </span>
          </label>
        </li>)}
        {!shown.length && <li className="px-3 py-2 text-sm">没有匹配的宾客</li>}
      </ul>
      <p className="text-sm">已选 {members.length} 人{selectedRows.length > 0 && `（${selectedRows.map(row => row.name).join('、')}）`}。</p>
      <p className="text-xs text-gray-600">保存时保留各人的桌位和住宿安排。</p>
      {members.length > MAX_GUEST_ROWS && <p role="alert">一户最多 {MAX_GUEST_ROWS} 人。</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose}>关闭</button>
        <button type="submit" className="bg-[#a44861] text-white" disabled={!valid || busy}>{busy ? '保存中…' : existing ? '保存整户' : '确认合并'}</button>
      </div>
    </form>
  </FusionDialog>
}
