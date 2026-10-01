import { useMemo, useState } from 'react'
import { BedDouble, Bed, DoorOpen, Plus, Download, Trash2, Search, X, UserPlus, Pencil, CalendarPlus } from 'lucide-react'
import { useWeddingStore } from '../stores/useWeddingStore'
import { ROOM_CAPACITY, type Guest, type Room } from '../types'
import { exportRoomsToExcel } from '../utils/exportRooms'
import { formatNight } from '../utils/date'
import DatePicker from '../components/DatePicker'

const ALL = '全部'

export default function AccommodationPage() {
  const rooms = useWeddingStore((s) => s.rooms)
  const guests = useWeddingStore((s) => s.guests)
  const stayDates = useWeddingStore((s) => s.stayDates)
  const addRoom = useWeddingStore((s) => s.addRoom)
  const updateRoom = useWeddingStore((s) => s.updateRoom)
  const removeRoom = useWeddingStore((s) => s.removeRoom)
  const assignGuestToRoom = useWeddingStore((s) => s.assignGuestToRoom)
  const setGuestStayDates = useWeddingStore((s) => s.setGuestStayDates)
  const addStayDate = useWeddingStore((s) => s.addStayDate)
  const removeStayDate = useWeddingStore((s) => s.removeStayDate)

  const [dateFilter, setDateFilter] = useState<string>(ALL)
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [pickerRoomId, setPickerRoomId] = useState<string | null>(null)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [addingDate, setAddingDate] = useState(false)

  // 某房间的入住人（按当前日期筛选）
  const occupantsOf = (room: Room): Guest[] => {
    const all = guests.filter((g) => g.roomId === room.id)
    if (dateFilter === ALL) return all
    return all.filter((g) => (g.stayDates || []).includes(dateFilter))
  }

  const visibleRooms = rooms.filter((r) => typeFilter === ALL || r.type === typeFilter)

  const stats = useMemo(() => {
    const king = rooms.filter((r) => r.type === '大床房').length
    const twin = rooms.filter((r) => r.type === '标间').length
    const stayed = guests.filter((g) => g.roomId).length
    const pending = guests.filter((g) => g.status === 'confirmed' && !g.roomId).length
    return { king, twin, total: rooms.length, stayed, pending }
  }, [rooms, guests])

  // 当晚用房统计（选中具体日期时）
  const nightStats = useMemo(() => {
    if (dateFilter === ALL) return null
    const occ = (r: Room) => guests.filter((g) => g.roomId === r.id && (g.stayDates || []).includes(dateFilter))
    const king = rooms.filter((r) => r.type === '大床房' && occ(r).length > 0).length
    const twin = rooms.filter((r) => r.type === '标间' && occ(r).length > 0).length
    const people = guests.filter((g) => g.roomId && (g.stayDates || []).includes(dateFilter)).length
    // 当日入住人数：当晚在住、且入住首日（最早一晚）正好是这一天的宾客
    const checkIn = guests.filter((g) => {
      const sd = g.stayDates || []
      return g.roomId && sd.includes(dateFilter) && dateFilter === [...sd].sort()[0]
    }).length
    return { king, twin, total: king + twin, people, checkIn }
  }, [dateFilter, rooms, guests])

  const handleExport = () => exportRoomsToExcel(rooms, guests, stayDates)

  const toggleNight = (g: Guest, date: string) => {
    const cur = g.stayDates || []
    const next = cur.includes(date) ? cur.filter((d) => d !== date) : [...cur, date]
    setGuestStayDates(g.id, next)
  }

  const startEditLabel = (room: Room) => {
    setEditingRoomId(room.id)
    setLabelDraft(room.label)
  }
  const commitLabel = () => {
    if (editingRoomId && labelDraft.trim()) updateRoom(editingRoomId, { label: labelDraft.trim() })
    setEditingRoomId(null)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6">
        {/* 顶部：标题 + 操作 */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">住宿安排</h2>
            <p className="text-sm text-gray-400 mt-0.5">为大床房 / 标间分配入住宾客，按晚次统计用房</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addRoom('大床房')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#f0c4d0] text-[#d4728a] hover:bg-[#fdf5f7] transition-colors"
            >
              <Plus className="w-4 h-4" /> 添加大床房
            </button>
            <button
              onClick={() => addRoom('标间')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#f0c4d0] text-[#d4728a] hover:bg-[#fdf5f7] transition-colors"
            >
              <Plus className="w-4 h-4" /> 添加标间
            </button>
            <button
              onClick={handleExport}
              disabled={rooms.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[#d4728a] text-white hover:bg-[#c25f79] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" /> 导出住宿表
            </button>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="bg-white rounded-xl border border-gray-100 p-3 mb-4 flex flex-col gap-2.5">
          {/* 日期 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-8 shrink-0">日期</span>
            <Seg active={dateFilter === ALL} onClick={() => setDateFilter(ALL)}>全部</Seg>
            {stayDates.map((d) => (
              <span key={d} className="flex items-center">
                <Seg active={dateFilter === d} onClick={() => setDateFilter(d)}>{formatNight(d)}</Seg>
                <button
                  onClick={() => { if (confirm(`删除 ${formatNight(d)} 这一晚？该晚的入住记录会被清除。`)) { removeStayDate(d); if (dateFilter === d) setDateFilter(ALL) } }}
                  className="ml-0.5 text-gray-300 hover:text-red-400"
                  title="删除该日期"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <span className="relative">
              <button
                onClick={() => setAddingDate((v) => !v)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-dashed border-[#f0c4d0] text-[#d4728a] hover:bg-[#fdf5f7]"
              >
                <CalendarPlus className="w-3.5 h-3.5" /> 添加日期
              </button>
              {addingDate && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAddingDate(false)} />
                  <DatePicker
                    onSelect={(iso) => addStayDate(iso)}
                    onClose={() => setAddingDate(false)}
                  />
                </>
              )}
            </span>
          </div>
          {/* 房型 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-8 shrink-0">房型</span>
            <Seg active={typeFilter === ALL} onClick={() => setTypeFilter(ALL)}>全部</Seg>
            <Seg active={typeFilter === '大床房'} onClick={() => setTypeFilter('大床房')}>大床房</Seg>
            <Seg active={typeFilter === '标间'} onClick={() => setTypeFilter('标间')}>标间</Seg>
          </div>
        </div>

        {/* 统计卡片 */}
        {nightStats ? (
          <div className="flex gap-4 mb-6 flex-wrap">
            <StatCard value={nightStats.king} label="大床房·当晚" color="#d4728a" />
            <StatCard value={nightStats.twin} label="标间·当晚" color="#7c9ec9" />
            <StatCard value={nightStats.total} label="当晚房间数" color="#5fae8f" />
            <StatCard value={nightStats.people} label="当晚总人数" color="#d99a4e" />
            <StatCard value={nightStats.checkIn} label="当日入住人数" color="#b07cc6" />
          </div>
        ) : (
          <div className="flex gap-4 mb-6 flex-wrap">
            <StatCard value={stats.king} label="大床房" color="#d4728a" />
            <StatCard value={stats.twin} label="标间" color="#7c9ec9" />
            <StatCard value={stats.total} label="合计房间" color="#5fae8f" />
            <StatCard value={stats.stayed} label="已入住" color="#d99a4e" />
            <StatCard value={stats.pending} label="待安排住宿" color="#9ca3af" />
          </div>
        )}

        {/* 房间卡片 */}
        {visibleRooms.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
            <BedDouble className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
              {rooms.length === 0 ? '还没有房间，点击右上角「添加大床房 / 添加标间」开始安排住宿' : '当前筛选条件下没有房间'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleRooms.map((room) => {
              const occupants = occupantsOf(room)
              const capacity = ROOM_CAPACITY[room.type]
              const over = occupants.length > capacity
              const emptyThisNight = dateFilter !== ALL && occupants.length === 0
              return (
                <div key={room.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col transition-opacity ${emptyThisNight ? 'opacity-60' : ''}`}>
                  {/* 卡片头：图标徽章 + 房号 */}
                  <div className={`flex items-center gap-3 px-4 py-3 bg-gradient-to-r to-white ${room.type === '大床房' ? 'from-[#fbeef2]' : 'from-[#e9f0fa]'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm ${room.type === '大床房' ? 'bg-[#d4728a]' : 'bg-[#7c9ec9]'}`}>
                      {room.type === '大床房' ? <BedDouble className="w-5 h-5" /> : <Bed className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        {editingRoomId === room.id ? (
                          <input
                            value={labelDraft}
                            autoFocus
                            onChange={(e) => setLabelDraft(e.target.value)}
                            onBlur={commitLabel}
                            onKeyDown={(e) => e.key === 'Enter' && commitLabel()}
                            className="w-28 px-2 py-0.5 border border-[#f0c4d0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                          />
                        ) : (
                          <button onClick={() => startEditLabel(room)} className="flex items-center gap-1 group min-w-0" title="点击修改房号">
                            <span className="font-semibold text-gray-800 truncate">{room.label}</span>
                            <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </div>
                      <span className={`text-xs ${room.type === '大床房' ? 'text-[#d4728a]' : 'text-[#7c9ec9]'}`}>{room.type}</span>
                    </div>
                    <button
                      onClick={() => { if (confirm(`删除 ${room.label}？入住宾客将被移出房间。`)) removeRoom(room.id) }}
                      className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-white/60 rounded-lg transition-colors shrink-0"
                      title="删除房间"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-4 flex-1 flex flex-col">

                  {/* 入住人 */}
                  <div className="flex-1">
                    {occupants.length === 0 ? (
                      <div className="text-sm text-gray-300 py-4 text-center border border-dashed border-gray-100 rounded-lg">
                        {emptyThisNight ? '该晚空置' : '暂无入住人'}
                      </div>
                    ) : (
                      <ul className="space-y-2 mb-1">
                        {occupants.map((g) => (
                          <li key={g.id} className="px-2.5 py-2 bg-[#faf9f7] rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-700 truncate">{g.name}</span>
                              <button
                                onClick={() => assignGuestToRoom(g.id, null)}
                                className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                                title="移出房间"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {/* 住哪几晚 */}
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {stayDates.length === 0 ? (
                                <span className="text-[11px] text-gray-300">先在上方「＋添加日期」，再点选住哪几晚</span>
                              ) : (
                                stayDates.map((d) => {
                                  const on = (g.stayDates || []).includes(d)
                                  return (
                                    <button
                                      key={d}
                                      onClick={() => toggleNight(g, d)}
                                      className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                                        on ? 'bg-[#d4728a] text-white' : 'bg-white text-gray-400 border border-gray-200 hover:border-[#f0c4d0]'
                                      }`}
                                    >
                                      {formatNight(d)}
                                    </button>
                                  )
                                })
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 容量 + 添加 */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <span className={`text-xs ${over ? 'text-red-400' : 'text-gray-400'}`}>
                      {room.type === '大床房' ? '按 1 户计' : `建议 ${capacity} 人`} · {dateFilter === ALL ? '共' : '当晚'} {occupants.length} 人
                      {over && '（超员）'}
                    </span>
                    <button
                      onClick={() => setPickerRoomId(room.id)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#f0c4d0] text-[#d4728a] hover:bg-[#fdf5f7] transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> 添加宾客
                    </button>
                  </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 宾客选择弹窗 */}
      {pickerRoomId && (
        <GuestPicker
          targetRoom={rooms.find((r) => r.id === pickerRoomId)!}
          guests={guests}
          onAssign={(guestId) => assignGuestToRoom(guestId, pickerRoomId)}
          onClose={() => setPickerRoomId(null)}
        />
      )}
    </div>
  )
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
        active ? 'bg-[#d4728a] text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-white rounded-xl p-4 flex-1 min-w-[110px] border border-gray-100">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  )
}

function GuestPicker({
  targetRoom,
  guests,
  onAssign,
  onClose,
}: {
  targetRoom: Room
  guests: Guest[]
  onAssign: (guestId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const roomState = (roomId: string | null) => (roomId ? (targetRoom.id === roomId ? '本房间' : '其他房间') : '未安排')

  const capacity = ROOM_CAPACITY[targetRoom.type]
  const occupantCount = guests.filter((g) => g.roomId === targetRoom.id).length

  const handleAssign = (guestId: string) => {
    onAssign(guestId)
    // 选够容量（2 人）后自动关闭弹窗
    if (occupantCount + 1 >= capacity) onClose()
  }

  const filtered = guests.filter(
    (g) => g.name.includes(q) || g.group.includes(q) || (g.phone || '').includes(q)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-[#d4728a]" />
            <span className="font-semibold text-gray-800">添加到「{targetRoom.label}」</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${occupantCount >= capacity ? 'bg-[#d4728a] text-white' : 'bg-gray-100 text-gray-500'}`}>
              已选 {occupantCount}/{capacity}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3">
          <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-rose-200">
            <Search className="w-4 h-4 text-gray-300" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索姓名 / 分组 / 电话"
              className="flex-1 text-sm outline-none"
              autoFocus
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">分配后请在房间卡片上点日期，手动选择 TA 住哪几晚。</p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-300 py-10">没有匹配的宾客，可先在「宾客名单」添加</p>
          ) : (
            <ul>
              {filtered.map((g) => {
                const inThisRoom = g.roomId === targetRoom.id
                const state = roomState(g.roomId)
                return (
                  <li key={g.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#fdf5f7]">
                    <div className="min-w-0">
                      <span className="text-sm text-gray-800">{g.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{g.group}</span>
                      {g.status === 'confirmed' && <span className="text-[11px] text-emerald-500 ml-2">已确认</span>}
                    </div>
                    {inThisRoom ? (
                      <span className="text-xs text-emerald-500 px-2 py-1 shrink-0">已入住</span>
                    ) : (
                      <button
                        onClick={() => handleAssign(g.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[#f0c4d0] text-[#d4728a] hover:bg-[#fdf5f7] transition-colors shrink-0"
                      >
                        {state === '未安排' ? '安排入住' : `移入（原${state}）`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
