import ResponsiveEditor from '../fusion/ResponsiveEditor'
import FusionFieldEditor from '../fusion/FusionFieldEditor'
import FusionGuestForm from '../fusion/FusionGuestForm'
import { ExportContext } from '../fusion/ExportContext'
import { useContext, useRef, useState } from 'react'
import { useWeddingStore, useAllGroups, useFusionMode } from '../fusion/PageContext'
import { Plus, Trash2, Search, UserCheck, UserX, Pencil, Check, X, TagPlus, Download, BedDouble } from 'lucide-react'
import type { Guest } from '../types'
import { exportGuestsToExcel } from '../utils/exportGuests'

export default function GuestsPage() {
  const openExport = useContext(ExportContext)
  const { guests, tables, rooms, addGuest, updateGuest, removeGuest, addCustomGroup, setGuestStayNeed } = useWeddingStore()
  const fusion = useFusionMode()
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const decliningGuest = guests.find(g => g.id === decliningId)
  const allGroups = useAllGroups()
  const [name, setName] = useState('')
  const [group, setGroup] = useState(allGroups[0])
  const [phone, setPhone] = useState('')
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState('全部')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const opener = useRef<HTMLElement | null>(null)
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

  const filtered = guests.filter((g) => {
    const matchSearch = g.name.includes(search) || (g.phone || '').includes(search)
    const matchGroup = filterGroup === '全部' || g.group === filterGroup
    return matchSearch && matchGroup
  })

  const assignedCount = guests.filter((g) => g.tableId).length
  const confirmedCount = guests.filter((g) => (g.attendance ?? (g.status === 'confirmed' ? 'confirmed' : 'pending')) === 'confirmed').length
  const unseatedCount = guests.filter(g => !g.tableId && g.attendance !== 'declined').length
  const declinedCount = guests.filter(g => g.attendance === 'declined').length
  const filterGroups = ['全部', ...allGroups]

  return (
    <div className={`${fusion ? 'planner-page planner-guests ' : ''}h-full min-w-0 [overflow-wrap:anywhere] overflow-y-auto sm:flex sm:flex-col p-3 sm:p-6 max-w-4xl mx-auto`}>
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
      <div className="planner-guests-stats grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{guests.length}</div>
          <div className="text-sm text-gray-500">总宾客数</div>
        </div>
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
      {decliningGuest && <section role="alertdialog" aria-label="确认不出席" className="border border-amber-300 rounded p-3 mb-3">
        <p>将“{decliningGuest.name}”设为不出席？会释放当前座位，住宿安排保留。以后改回出席也不会自动恢复原座位。</p>
        <button disabled={savingAttendance} className="text-red-700 mr-4" onClick={async () => {
          setSavingAttendance(true)
          try { if (await updateGuest(decliningGuest.id, { attendance: 'declined' }) !== false) setDecliningId(null) }
          finally { setSavingAttendance(false) }
        }}>确认不出席并释放座位</button>
        <button disabled={savingAttendance} onClick={() => setDecliningId(null)}>取消</button>
      </section>}

      {/* Add form */}
      <ResponsiveEditor enabled={fusion} label={editingId ? '编辑宾客' : '添加宾客'} open={showGuestEditor}>
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4 [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full">
        {fusion ? <FusionGuestForm key={editingId ?? 'new'} guestId={editingId ?? undefined} focusOnOpen={showGuestEditor || !!editingId} onClose={showGuestEditor || editingId ? closeGuestEditor : undefined} groups={allGroups} onAddGroup={() => setShowAddGroup(true)} /> : (
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
        <div className="min-w-0 max-w-full flex gap-1 flex-wrap">
          {filterGroups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(g)}
              className={`max-w-full break-words [overflow-wrap:anywhere] px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterGroup === g
                  ? 'bg-[#d4728a] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Guest list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            {guests.length === 0 ? '还没有添加宾客，从上方开始添加吧' : '没有匹配的宾客'}
          </div>
        )}
        {filtered.map((guest) => (
          <div
            key={guest.id}
            className="bg-white rounded-lg px-4 py-3 border border-gray-100 flex flex-wrap sm:flex-nowrap items-center gap-3 group"
          >
            {!fusion && editingId === guest.id ? (
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
                    {fusion ? <span className="text-xs text-gray-600">{guest.tableId ? tables.find(t => t.id === guest.tableId)?.label ?? '已排座' : '未排座'}</span> : guest.status === 'confirmed' ? (
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
                    {guest.roomId && (
                      <span className="min-w-0 text-xs px-2 py-0.5 rounded-full bg-[#eef3fa] text-[#7c9ec9] flex items-center gap-0.5">
                        <BedDouble className="w-3 h-3" />
                        {rooms.find((r) => r.id === guest.roomId)?.label || '已安排住宿'}
                      </span>
                    )}
                  </div>
                  {fusion && <div className="flex flex-wrap gap-3 text-xs text-gray-600 mt-2">
                    <label>出席状态 <select aria-label={`${guest.name}的出席状态`} className="border rounded p-1" value={guest.attendance ?? 'pending'} onChange={e => {
                      const attendance = e.target.value as NonNullable<Guest['attendance']>
                      if (attendance === 'declined' && guest.tableId) { setDecliningId(guest.id); return }
                      void updateGuest(guest.id, { attendance })
                    }}>
                      <option value="pending">待确认</option><option value="confirmed">已确认</option><option value="declined">不出席</option>
                    </select></label>
                    <label>归属 <select aria-label={`${guest.name}的归属`} className="border rounded p-1" value={guest.side ?? 'unset'} onChange={e => void updateGuest(guest.id, { side: e.target.value as NonNullable<Guest['side']> })}>
                      <option value="unset">未设置</option><option value="bride">女方</option><option value="groom">男方</option><option value="shared">共同</option>
                    </select></label>
                  </div>}
                  {setGuestStayNeed && <label className="block text-xs text-gray-500 mt-2">住宿需求
                    <select aria-label={`${guest.name}的住宿需求`} className="ml-2 border rounded p-1" value={guest.stayNeed ?? 'pending'} onChange={e => {
                      const value = e.target.value as 'pending' | 'needed' | 'not_needed'
                      if (guest.roomId && value === 'not_needed' && !confirm(`将“${guest.name}”改为不需要住宿？房间和住宿晚次将清除，并保留在回收站。`)) return
                      setGuestStayNeed(guest.id, value)
                    }}>
                      <option value="pending" disabled={!!guest.roomId}>待确认</option><option value="needed">需要住宿</option><option value="not_needed">不需要住宿</option>
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
                  onClick={() => { if (confirm(`删除宾客“${guest.name}”？其座位、房间和住宿晚次安排也会一并移除。`)) removeGuest(guest.id) }}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
