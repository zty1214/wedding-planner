import { useState } from 'react'
import { useWeddingStore, useAllGroups } from '../stores/useWeddingStore'
import { Plus, Trash2, Search, UserCheck, UserX, Pencil, Check, X, TagPlus } from 'lucide-react'

export default function GuestsPage() {
  const { guests, addGuest, updateGuest, removeGuest, addCustomGroup } = useWeddingStore()
  const allGroups = useAllGroups()
  const [name, setName] = useState('')
  const [group, setGroup] = useState(allGroups[0])
  const [phone, setPhone] = useState('')
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState('全部')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [editPhone, setEditPhone] = useState('')

  const handleAdd = () => {
    if (!name.trim()) return
    addGuest(name.trim(), group, phone.trim() || undefined)
    setName('')
    setPhone('')
  }

  const handleAddGroup = () => {
    if (!newGroup.trim()) return
    addCustomGroup(newGroup.trim())
    setGroup(newGroup.trim())
    setNewGroup('')
    setShowAddGroup(false)
  }

  const startEdit = (id: string) => {
    const guest = guests.find((g) => g.id === id)
    if (!guest) return
    setEditingId(id)
    setEditName(guest.name)
    setEditGroup(guest.group)
    setEditPhone(guest.phone || '')
  }

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return
    updateGuest(editingId, { name: editName.trim(), group: editGroup, phone: editPhone.trim() || undefined })
    setEditingId(null)
  }

  const filtered = guests.filter((g) => {
    const matchSearch = g.name.includes(search) || (g.phone || '').includes(search)
    const matchGroup = filterGroup === '全部' || g.group === filterGroup
    return matchSearch && matchGroup
  })

  const assignedCount = guests.filter((g) => g.tableId).length
  const confirmedCount = guests.filter((g) => g.status === 'confirmed').length
  const filterGroups = ['全部', ...allGroups]

  return (
    <div className="h-full flex flex-col p-6 max-w-4xl mx-auto">
      {/* Stats */}
      <div className="flex gap-4 mb-6">
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
          <div className="text-2xl font-bold text-amber-500">{guests.length - assignedCount}</div>
          <div className="text-sm text-gray-500">待分配</div>
        </div>
      </div>

      {/* Add form */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
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

        {/* Custom group input */}
        {showAddGroup && (
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

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名或手机号"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {filterGroups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(g)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
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
            className="bg-white rounded-lg px-4 py-3 border border-gray-100 flex items-center gap-3 group"
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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
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
                  </div>
                  {guest.phone && (
                    <div className="text-xs text-gray-400 mt-0.5">{guest.phone}</div>
                  )}
                </div>
                <button
                  onClick={() => startEdit(guest.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-[#d4728a] transition-all"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeGuest(guest.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
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
