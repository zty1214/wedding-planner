import { BedDouble, Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { TRAVEL_LABELS } from '../types'
import type { Guest, Room, Table } from '../types'
import type { GuestStatusPatch } from '../types/weddingState'
import { ATTENDANCE_LABELS, STAY_NEED_LABELS } from './guestRoster'
import { guestStays } from './guestStays'

function commonValue<T>(values: T[]): T | '' {
  return values.every(value => value === values[0]) ? values[0] : ''
}

function StatusSelect<T extends string>({ name, label, value, values, blocked, onChange }: {
  name: string; label: string; value: T | ''; values: Record<T, string>; blocked?: T
  onChange(value: T): void
}) {
  return <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center">{label}
    <select aria-label={name} className="min-w-0 border rounded p-1" value={value}
      onChange={event => onChange(event.target.value as T)}>
      {value === '' && <option value="" disabled>各成员不同</option>}
      {(Object.keys(values) as T[]).map(option => <option key={option} value={option} disabled={option === blocked}>{values[option]}</option>)}
    </select>
  </label>
}

export default function FusionRosterCard({ name, members, tables, rooms, onStatus, onEdit, onDelete, expanded, onToggleMembers, children }: {
  name: string; members: Guest[]; tables: Table[]; rooms: Room[]
  onStatus(patch: GuestStatusPatch): void; onEdit(): void; onDelete?(): void
  expanded?: boolean; onToggleMembers?(): void; children?: ReactNode
}) {
  const household = !!onToggleMembers
  const title = household ? `${name}（${members.length} 人）` : name
  const label = (field: string) => `${name}${household ? '整户' : '的'}${field}`
  const tags = [...new Set(members.map(guest => guest.group).filter(Boolean))]
  const tableIds = [...new Set(members.flatMap(guest => guest.tableId ? [guest.tableId] : []))]
  const roomIds = [...new Set(members.flatMap(guest => guestStays(guest).map(stay => stay.roomId)))]
  return <article aria-label={title} className="min-w-0 rounded-lg border border-gray-100 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
    <div className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
      <span className="text-sm font-semibold text-gray-800">{title}</span>
      {tags.map(tag => <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>)}
      {tableIds.map(id => <span key={id} className="text-xs text-gray-600">{tables.find(table => table.id === id)?.label ?? '已排座'}</span>)}
      {(!tableIds.length || members.some(guest => !guest.tableId && guest.attendance !== 'declined')) &&
        <span className="text-xs text-gray-600">{tableIds.length ? '部分未排座' : '未排座'}</span>}
      {roomIds.map(id => <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#eef3fa] px-2 py-0.5 text-xs text-[#426791]">
        <BedDouble className="h-3 w-3 shrink-0" />{rooms.find(room => room.id === id)?.label ?? '已安排住宿'}
      </span>)}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {household && <button type="button" aria-expanded={!!expanded} onClick={onToggleMembers}
          className="whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-[#a44861] hover:bg-[#fdf5f7]">{expanded ? '收起成员' : '展开成员'}</button>}
        <button type="button" data-guest-form-switch={household ? undefined : ''} onClick={onEdit}
          className="rounded-md p-2 text-gray-600 hover:bg-[#fdf5f7] hover:text-[#a44861]" title={household ? '编辑整户' : '编辑'} aria-label={`编辑${household ? '整户 ' : ' '}${name}`}>
          <Pencil className="h-4 w-4" />
        </button>
        {onDelete && <button type="button" onClick={onDelete} className="rounded-md p-2 text-gray-600 hover:bg-red-50 hover:text-red-600"
          title="删除" aria-label={`删除 ${name}`}><Trash2 className="h-4 w-4" /></button>}
      </div>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
      <StatusSelect name={label('出席状态')} label="出席状态" value={commonValue(members.map(guest => guest.attendance ?? 'pending'))}
        values={ATTENDANCE_LABELS} onChange={attendance => onStatus({ attendance })} />
      <StatusSelect name={label('住宿需求')} label="住宿需求" value={commonValue(members.map(guest => guest.stayNeed ?? 'pending'))}
        values={STAY_NEED_LABELS} blocked={roomIds.length ? 'pending' : undefined} onChange={stayNeed => onStatus({ stayNeed })} />
      <StatusSelect name={label('出行方式')} label="出行方式" value={commonValue(members.map(guest => guest.travelMode ?? 'pending'))}
        values={TRAVEL_LABELS} onChange={travelMode => onStatus({ travelMode })} />
    </div>
    {!household && members[0].phone && <div className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">{members[0].phone}</div>}
    {children && <div className="mt-3 space-y-2 border-l-2 border-[#f2e3e8] pl-2 sm:pl-3">{children}</div>}
  </article>
}
