import ResponsiveEditor from '../fusion/ResponsiveEditor'
import FusionFieldEditor from '../fusion/FusionFieldEditor'
import FusionGuestForm from '../fusion/FusionGuestForm'
import FusionDialog from '../fusion/FusionDialog'
import FusionRosterCard from '../fusion/FusionRosterCard'
import FusionHouseholdMerge from '../fusion/FusionHouseholdMerge'
import { guestStays } from '../fusion/guestStays'
import GuestRosterImport from '../fusion/GuestRosterImport'
import { ExportContext } from '../fusion/ExportContext'
import { RepositoryContext } from '../fusion/RepositoryContext'
import { useContext, useRef, useState } from 'react'
import { useWeddingStore, useAllGroups, useFusionMode } from '../fusion/PageContext'
import { Plus, Trash2, Search, UserCheck, UserX, Pencil, Check, X, TagPlus, Download, BedDouble } from 'lucide-react'
import type { Guest } from '../types'
import type { GuestStatusPatch } from '../types/weddingState'
import { exportGuestsToExcel } from '../utils/exportGuests'
import { MAX_GUEST_ROWS, STAY_NEED_LABELS } from '../fusion/guestRoster'

type ListSort = 'added' | 'recent' | 'table'
const needsSeat = (guest: Guest) => !guest.tableId && guest.attendance !== 'declined'
const tableNames = new Intl.Collator('zh-CN', { numeric: true })

export default function GuestsPage() {
  const openExport = useContext(ExportContext)
  const repo = useContext(RepositoryContext)
  const formEpoch = repo?.getSnapshot().snapshot?.dataEpoch
  const { guests, tables, rooms, addGuest, addHousehold, mergeHousehold, setHouseholdStatus, updateGuest, removeGuest, addCustomGroup, setGuestStayNeed } = useWeddingStore()
  const fusion = useFusionMode()
  const [declining, setDeclining] = useState<{ id: string; household: boolean } | null>(null)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [expandedHouseholds, setExpandedHouseholds] = useState<string[]>([])
  const allGroups = useAllGroups()
  const [name, setName] = useState('')
  const [group, setGroup] = useState(allGroups[0])
  const [phone, setPhone] = useState('')
  const [search, setSearch] = useState('')
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [onlyUnseated, setOnlyUnseated] = useState(false)
  const [listSort, setListSort] = useState<ListSort>('added')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const opener = useRef<HTMLElement | null>(null)
  const [showHouseholdForm, setShowHouseholdForm] = useState(false)
  const [showGuestEditor, setShowGuestEditor] = useState(false)
  function closeGuestEditor() {
    setShowGuestEditor(false); setEditingId(null); setShowAddGroup(false)
    requestAnimationFrame(() => { if (opener.current?.isConnected) { opener.current.scrollIntoView({ block: 'nearest' }); opener.current.focus() } })
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [editPhone, setEditPhone] = useState('')

  const handleAdd = async () => {
    if (!name.trim()) return
    if (await addGuest(name.trim(), group, phone.trim() || undefined) === false) return
    setName('')
    setPhone('')
  }

  const handleAddGroup = async () => {
    if (!newGroup.trim()) return
    if (await addCustomGroup(newGroup.trim()) === false) return
    setGroup(newGroup.trim())
    setNewGroup('')
    setShowAddGroup(false)
  }

  const startEdit = (id: string) => {
    const guest = guests.find((g) => g.id === id)
    if (!guest) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShowGuestEditor(true); setEditingId(id)
    setEditName(guest.name)
    setEditGroup(guest.group)
    setEditPhone(guest.phone || '')
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return
    if (await updateGuest(editingId, { name: editName.trim(), group: editGroup, phone: editPhone.trim() || undefined }) === false) return
    setEditingId(null)
  }

  const toggleGroupFilter = (category: string | null) => {
    setSelectedGroups(current => {
      if (category === null) return []
      if (!fusion) return [category]
      return current.includes(category) ? current.filter(group => group !== category) : [...current, category]
    })
  }

  const filtered = guests.filter((g) => {
    const matchSearch = g.name.includes(search) || (g.phone || '').includes(search) || g.household?.name.includes(search)
    const matchGroup = selectedGroups.length === 0 || selectedGroups.includes(g.group)
    return matchSearch && matchGroup && (!onlyUnseated || needsSeat(g))
  })
  if (listSort === 'recent') filtered.reverse()
  if (listSort === 'table') {
    const byId = new Map(tables.map((table, order) => [table.id, { label: table.label, order }]))
    filtered.sort((a, b) => {
      const left = a.tableId ? byId.get(a.tableId) : undefined, right = b.tableId ? byId.get(b.tableId) : undefined
      if (!left || !right) return Number(!!right) - Number(!!left)
      return tableNames.compare(left.label, right.label) || left.order - right.order || (a.seatIndex ?? 0) - (b.seatIndex ?? 0)
    })
  }

  const rosterKey = (guest: Guest) => fusion && guest.household ? `household:${guest.household.id}` : `guest:${guest.id}`
  const roster = new Map<string, Guest[]>()
  for (const guest of guests) {
    const key = rosterKey(guest)
    const members = roster.get(key) ?? []
    members.push(guest)
    roster.set(key, members)
  }
  const visibleRows = [...new Set(filtered.map(rosterKey))]
  const householdCount = roster.size
  const declineMembers = declining ? declining.household ? roster.get(`household:${declining.id}`) ?? []
    : guests.filter(guest => guest.id === declining.id) : []
  const declineName = declining?.household ? declineMembers[0]?.household?.name : declineMembers[0]?.name
  const declineSeats = declineMembers.filter(guest => guest.tableId).length
  function saveStatus(id: string, household: boolean, patch: GuestStatusPatch) {
    if (household) return setHouseholdStatus?.(id, patch)
    if ('stayNeed' in patch) return setGuestStayNeed?.(id, patch.stayNeed)
    return updateGuest(id, patch)
  }
  function requestStatus(members: Guest[], patch: GuestStatusPatch, householdId?: string) {
    const id = householdId ?? members[0].id
    if ('attendance' in patch && patch.attendance === 'declined' && members.some(guest => guest.tableId)) {
      setDeclining({ id, household: !!householdId })
      return
    }
    if ('stayNeed' in patch && patch.stayNeed === 'not_needed' && members.some(guest => guest.roomId)) {
      const name = householdId ? members[0].household?.name + '整户' : members[0].name
      if (!confirm(`将“${name}”设为不需要住宿？会清除相关房间和住宿晚次，可在回收站恢复。`)) return
    }
    void saveStatus(id, !!householdId, patch)
  }
  function deleteGuest(guest: Guest) {
    if (confirm(`删除宾客“${guest.name}”？其座位、房间和住宿晚次安排也会一并移除。`)) removeGuest(guest.id)
  }
  const renderMember = (guest: Guest) => <FusionRosterCard key={guest.id} name={guest.name} members={[guest]} tables={tables} rooms={rooms}
    onStatus={patch => requestStatus([guest], patch)} onEdit={() => startEdit(guest.id)} onDelete={() => deleteGuest(guest)} />

  const assignedCount = guests.filter((g) => g.tableId).length
  const confirmedCount = guests.filter((g) => (g.attendance ?? (g.status === 'confirmed' ? 'confirmed' : 'pending')) === 'confirmed').length
  const unseatedCount = guests.filter(needsSeat).length
  const declinedCount = guests.filter(g => g.attendance === 'declined').length
  const filterGroups = [null, ...allGroups]
  const allFilterLabel = allGroups.includes('全部') ? '清除类别筛选' : '全部'

  const renderLegacyGuest = (guest: Guest) => (
    <div
      key={guest.id}
      className="bg-white rounded-lg px-4 py-3 border border-gray-100 flex flex-wrap sm:flex-nowrap items-center gap-3 group"
    >
      {editingId === guest.id ? (
        /* Edit mode */
        <div className="flex-1 flex items-center gap-2 flex-wrap">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            className="w-24 px-2 py-1 border border-rose-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-rose-300"
            autoFocus
          />
          <select
            value={editGroup}
            onChange={(e) => setEditGroup(e.target.value)}
            className="px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none"
          >
            {allGroups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            placeholder="手机号"
            className="w-32 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none"
          />
          <button
            onClick={saveEdit}
            className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded transition-colors"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setEditingId(null)}
            className="p-1.5 text-gray-400 hover:bg-gray-50 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Display mode */
        <>
          <div className="flex-1 min-w-0 basis-full sm:basis-auto">
            <div className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              <span className="font-medium text-gray-800 text-sm">{guest.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {guest.group}
              </span>
              {guest.status === 'confirmed' ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-0.5">
                  <UserCheck className="w-3 h-3" /> 已确认
                </span>
              ) : guest.tableId ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 flex items-center gap-0.5">
                  <UserCheck className="w-3 h-3" /> 已分配
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 flex items-center gap-0.5">
                  <UserX className="w-3 h-3" /> 待分配
                </span>
              )}
              {guestStays(guest).map(stay => (
                <span key={stay.roomId} className="min-w-0 text-xs px-2 py-0.5 rounded-full bg-[#eef3fa] text-[#7c9ec9] flex items-center gap-0.5">
                  <BedDouble className="w-3 h-3" />
                  {rooms.find(r => r.id === stay.roomId)?.label || '已安排住宿'}
                </span>
              ))}
            </div>
            {setGuestStayNeed && <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">住宿需求
              <select aria-label={`${guest.name}的住宿需求`} className="min-w-0 border rounded p-1" value={guest.stayNeed ?? 'pending'} onChange={e =>
                requestStatus([guest], { stayNeed: e.target.value as NonNullable<Guest['stayNeed']> })}>
                {Object.entries(STAY_NEED_LABELS).map(([value, label]) => <option key={value} value={value} disabled={!!guest.roomId && value === 'pending'}>{label}</option>)}
              </select>
            </label>}
            {guest.phone && (
              <div className="text-xs text-gray-400 mt-0.5 [overflow-wrap:anywhere]">{guest.phone}</div>
            )}
          </div>
          <button
            data-guest-form-switch
            onClick={() => startEdit(guest.id)}
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1.5 text-gray-400 hover:text-[#d4728a] transition-all"
            title="编辑"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => deleteGuest(guest)}
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )

  return (
    <div className={`${fusion ? 'planner-page planner-guests' : 'sm:flex sm:flex-col'} h-full min-w-0 [overflow-wrap:anywhere] overflow-y-auto p-3 sm:p-6 max-w-4xl mx-auto`}>
      {/* Header with export */}
      <div className="planner-guests-heading flex items-center justify-between mb-4">
        <div><h2 className="text-base font-semibold text-gray-800">宾客名单</h2>{fusion && <p className="planner-description">记录每一位重要的人，确认出席与安排。</p>}</div>
        {fusion && <button data-guest-form-switch className="md:hidden border rounded px-3" onClick={event => { opener.current = event.currentTarget; setShowGuestEditor(true); setEditingId(null) }}>添加宾客</button>}
        <button
          onClick={() => openExport ? openExport('guests') : exportGuestsToExcel(guests, tables)}
          disabled={guests.length === 0}
          className="planner-guests-export flex items-center gap-1.5 px-3 py-2 bg-[#d4728a] text-white rounded-lg text-sm font-medium hover:bg-[#b85a72] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-4 h-4" /> 导出名单
        </button>
      </div>

      {/* Stats */}
      <div className={`planner-guests-stats grid grid-cols-2 ${fusion ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3 sm:gap-4 mb-6`}>
        <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{guests.length}</div>
          <div className="text-sm text-gray-500">总宾客数</div>
        </div>
        {fusion && <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{householdCount}</div>
          <div className="text-sm text-gray-500">总户数</div>
        </div>}
        <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-emerald-600">{confirmedCount}</div>
          <div className="text-sm text-gray-500">确认出席</div>
        </div>
        <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-[#d4728a]">{assignedCount}</div>
          <div className="text-sm text-gray-500">已分配座位</div>
        </div>
        <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-amber-500">{unseatedCount}</div>
          <div className="text-sm text-gray-500">待分配</div>
        </div>
      </div>

      {fusion && <p className="text-sm text-gray-500 mb-3">不出席：{declinedCount} 人（不计入待分配）；出席状态与排座、住宿分别管理。</p>}
      {declining && declineName && <FusionDialog label="确认不出席" onClose={() => { if (!savingAttendance) setDeclining(null) }}>
        <div className="space-y-3 p-4 sm:p-6">
          <p>将“{declineName}”{declining.household ? '整户' : ''}设为不出席？会释放 {declineSeats} 个座位，保留住宿安排。</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button disabled={savingAttendance} onClick={() => setDeclining(null)}>取消</button>
            <button disabled={savingAttendance} className="text-red-700" onClick={async () => {
              setSavingAttendance(true)
              try {
                if (await saveStatus(declining.id, declining.household, { attendance: 'declined' }) !== false) setDeclining(null)
              } finally { setSavingAttendance(false) }
            }}>确认不出席并释放座位</button>
          </div>
        </div>
      </FusionDialog>}

      {/* Add form */}
      <ResponsiveEditor enabled={fusion} label={editingId ? '编辑宾客' : '添加宾客'} open={showGuestEditor} forceModal={!!editingId}>
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4 [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full">
        {fusion ? <>
          {editingId && <h2 className="mb-3 text-base font-semibold">编辑宾客</h2>}
          <FusionGuestForm key={JSON.stringify([formEpoch, editingId])} guestId={editingId ?? undefined} focusOnOpen={showGuestEditor || !!editingId} onClose={showGuestEditor || editingId ? closeGuestEditor : undefined} groups={allGroups} onAddGroup={() => setShowAddGroup(true)} />
        </> : (
        <div className="flex gap-3 flex-wrap items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="宾客姓名"
            className="flex-1 min-w-[120px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
          <div className="flex items-center gap-1">
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
            >
              {allGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <button
              onClick={() => setShowAddGroup(true)}
              className="p-2 text-gray-400 hover:text-[#d4728a] hover:bg-[#fdf5f7] rounded-lg transition-colors"
              title="添加自定义类别"
            >
              <TagPlus className="w-4 h-4" />
            </button>
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="手机号（选填）"
            className="w-40 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-4 py-2 bg-[#d4728a] text-white rounded-lg text-sm font-medium hover:bg-[#b85a72] transition-colors"
          >
            <Plus className="w-4 h-4" /> 添加
          </button>
        </div>
        )}

        {/* Custom group input */}
        {showAddGroup && fusion && <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
          <FusionFieldEditor kind="group" entityId="config" label="新类别名称" value="" submitLabel="添加类别" />
          <button onClick={() => setShowAddGroup(false)} className="text-sm text-gray-500">关闭</button>
        </div>}
        {showAddGroup && !fusion && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
              placeholder="输入新类别名称，如：新娘同事"
              autoFocus
              className="flex-1 px-3 py-1.5 border border-rose-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
            />
            <button
              onClick={handleAddGroup}
              className="px-3 py-1.5 bg-[#d4728a] text-white text-sm rounded-lg hover:bg-[#b85a72] transition-colors"
            >
              确定
            </button>
            <button
              onClick={() => setShowAddGroup(false)}
              className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>

      </ResponsiveEditor>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名或手机号"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div role="group" aria-label="宾客类别筛选" className="min-w-0 max-w-full flex gap-1 flex-wrap">
          {filterGroups.map(category => {
            const selected = category === null ? selectedGroups.length === 0 : selectedGroups.includes(category)
            return (
              <button
                key={category === null ? 'all' : `category:${category}`}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleGroupFilter(category)}
                className={`max-w-full break-words [overflow-wrap:anywhere] px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selected ? 'bg-[#d4728a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {category ?? allFilterLabel}
              </button>
            )
          })}
        </div>
      </div>

      {fusion && <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="宾客名单筛选和排序">
        <button type="button" aria-pressed={onlyUnseated} onClick={() => setOnlyUnseated(value => !value)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${onlyUnseated ? 'bg-[#d4728a] text-white' : 'bg-white text-gray-700'}`}>只看待分配</button>
        <label className="flex items-center gap-2 text-sm text-gray-600">排序
          <select aria-label="名单排序" value={listSort} onChange={e => setListSort(e.target.value as ListSort)} className="min-w-0 border rounded text-sm">
            <option value="added">添加顺序（最早在前）</option>
            <option value="recent">添加顺序（最近在前）</option>
            <option value="table">桌号（升序）</option>
          </select>
        </label>
        {addHousehold && <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setShowHouseholdForm(true)}>添加一户</button>}
        {mergeHousehold && <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setMergeTarget('')}>合并成一户</button>}
        <GuestRosterImport />
      </div>}

      {/* Guest list */}
      <div className={fusion ? 'space-y-2' : 'flex-1 overflow-y-auto space-y-2'}>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            {guests.length === 0 ? '还没有添加宾客，从上方开始添加吧' : '没有匹配的宾客'}
          </div>
        )}
        {fusion ? visibleRows.map(key => {
          const members = roster.get(key)!
          const household = members[0].household
          if (!household) return renderMember(members[0])
          const expanded = expandedHouseholds.includes(household.id)
          return <FusionRosterCard key={key} name={household.name} members={members} tables={tables} rooms={rooms}
            onStatus={patch => requestStatus(members, patch, household.id)} onEdit={() => setMergeTarget(key)} expanded={expanded}
            onToggleMembers={() => setExpandedHouseholds(current => expanded ? current.filter(id => id !== household.id) : [...current, household.id])}>
            {expanded && members.map(renderMember)}
          </FusionRosterCard>
        }) : filtered.map(renderLegacyGuest)}
      </div>
      {mergeHousehold && mergeTarget !== null && <FusionHouseholdMerge rows={roster} tables={tables} existing={mergeTarget || undefined}
        onSave={mergeHousehold} onClose={() => setMergeTarget(null)} />}
      {addHousehold && showHouseholdForm && <HouseholdForm groups={allGroups} save={addHousehold} onClose={() => setShowHouseholdForm(false)} />}
    </div>
  )
}

function HouseholdForm({ groups, save, onClose }: {
  groups: string[]
  save(name: string, group: string, count: number): Promise<boolean>
  onClose(): void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState(groups[0] ?? '')
  const [count, setCount] = useState('2')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const size = Number(count)
  const valid = !!name.trim() && Number.isSafeInteger(size) && size >= 1 && size <= MAX_GUEST_ROWS

  return <FusionDialog label="添加一户" onClose={onClose}>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault()
      if (submitting.current || !valid) return
      submitting.current = true; setBusy(true); setError('')
      try {
        if (await save(name.trim(), group, size)) onClose()
        else setError('未能添加，请核对顶部同步状态后重试。')
      } catch { setError('未能添加，请核对顶部同步状态后重试。') }
      finally { submitting.current = false; setBusy(false) }
    }}>
      <h2 className="text-base font-semibold">添加一户</h2>
      <label className="grid gap-1 text-sm">户名
        <input autoFocus required value={name} onChange={event => setName(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm">人数
          <input type="number" min="1" max={MAX_GUEST_ROWS} required value={count} onChange={event => setCount(event.target.value)} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">分组标签
          <select value={group} onChange={event => setGroup(event.target.value)}>{groups.map(value => <option key={value}>{value}</option>)}</select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose}>关闭</button>
        <button type="submit" disabled={!valid || busy}>{busy ? '正在添加…' : '添加'}</button>
      </div>
    </form>
  </FusionDialog>
}
