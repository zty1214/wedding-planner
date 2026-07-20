import { useState, useRef } from 'react'
import { useWeddingStore } from '../stores/useWeddingStore'
import { TABLE_PRESETS } from '../types'
import SeatingCanvas from '../components/seating/SeatingCanvas'
import { Download, Plus, Trash2, X, UserPlus, Pencil, GripVertical } from 'lucide-react'

export default function SeatingPage() {
  const { tables, guests, addTable, removeTable, updateTable, assignGuestToTable, updateGuest } = useWeddingStore()
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const stageRef = useRef<any>(null)

  const selectedTable = tables.find((t) => t.id === selectedTableId)
  const tableGuests = guests
    .filter((g) => g.tableId === selectedTableId)
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
  const unassignedGuests = guests.filter((g) => !g.tableId)

  const handleAddTable = (seats: number) => {
    const offsetX = 150 + (tables.length % 4) * 190
    const offsetY = 160 + Math.floor(tables.length / 4) * 210
    addTable(seats, offsetX, offsetY)
  }

  const handleExport = () => {
    if (!stageRef.current) return
    const uri = stageRef.current.toDataURL({ pixelRatio: 2 })
    const link = document.createElement('a')
    link.download = `座位图_${new Date().toLocaleDateString('zh-CN')}.png`
    link.href = uri
    link.click()
  }

  const handleAssign = (guestId: string) => {
    if (!selectedTable) return
    const usedSeats = tableGuests.map((g) => g.seatIndex)
    const nextSeat = Array.from({ length: selectedTable.seats }, (_, i) => i).find(
      (i) => !usedSeats.includes(i)
    )
    if (nextSeat === undefined) return
    assignGuestToTable(guestId, selectedTable.id, nextSeat)
  }

  const handleUnassign = (guestId: string) => {
    assignGuestToTable(guestId, null, null)
  }

  const handleToggleConfirm = (guestId: string, currentStatus: string) => {
    updateGuest(guestId, { status: currentStatus === 'confirmed' ? 'assigned' : 'confirmed' })
  }

  const handleSaveLabel = () => {
    if (selectedTable && labelDraft.trim()) {
      updateTable(selectedTable.id, { label: labelDraft.trim() })
    }
    setEditingLabel(false)
  }

  // Drag-and-drop reorder
  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex || !selectedTable) return
    const dragGuest = tableGuests.find((g) => g.seatIndex === dragIndex)
    const targetGuest = tableGuests.find((g) => g.seatIndex === targetIndex)
    if (dragGuest) assignGuestToTable(dragGuest.id, selectedTable.id, targetIndex)
    if (targetGuest) assignGuestToTable(targetGuest.id, selectedTable.id, dragIndex)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="h-full flex">
      {/* Left panel */}
      <div className="w-52 bg-white border-r border-gray-100 p-4 flex flex-col shrink-0">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">图形库</h3>
        <div className="space-y-2">
          {TABLE_PRESETS.map((preset) => (
            <button
              key={preset.seats}
              onClick={() => handleAddTable(preset.seats)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#f0c4d0] hover:bg-[#fdf5f7] transition-colors group"
            >
              <div className="w-10 h-10 rounded-full border-2 border-gray-300 group-hover:border-[#d4728a] flex items-center justify-center text-xs text-gray-500 group-hover:text-[#d4728a] transition-colors">
                {preset.seats}人
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-gray-700">{preset.label}</div>
                <div className="text-xs text-gray-400">点击添加到画布</div>
              </div>
              <Plus className="w-4 h-4 ml-auto text-gray-300 group-hover:text-[#d4728a]" />
            </button>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">统计</h3>
          <div className="text-xs text-gray-500 space-y-1">
            <div>桌数：{tables.length} 桌</div>
            <div>总座位：{tables.reduce((s, t) => s + t.seats, 0)} 个</div>
            <div>已入座：{guests.filter((g) => g.tableId).length} 人</div>
            <div>已确认：{guests.filter((g) => g.status === 'confirmed').length} 人</div>
            <div>待分配：{unassignedGuests.length} 人</div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 mb-2">图例</h3>
          <div className="space-y-1.5 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-[#f7f6f5] border border-[#ddd9d5]" />
              空位
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-[#fdf5f7] border border-[#f0c4d0]" />
              已分配待确认
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-[#d4728a] border border-[#b85a72]" />
              确认出席
            </div>
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={tables.length === 0}
          className="mt-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-[#d4728a] text-white rounded-lg text-sm font-medium hover:bg-[#b85a72] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-4 h-4" /> 导出 PNG
        </button>
      </div>

      {/* Canvas */}
      <SeatingCanvas
        selectedTableId={selectedTableId}
        onSelectTable={setSelectedTableId}
        stageRef={stageRef}
      />

      {/* Right panel */}
      {selectedTable && (
        <div className="w-72 bg-white border-l border-gray-100 p-4 flex flex-col shrink-0 overflow-y-auto">
          {/* Table name - editable */}
          <div className="flex items-center justify-between mb-4">
            {editingLabel ? (
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveLabel()}
                onBlur={handleSaveLabel}
                autoFocus
                className="text-sm font-semibold text-gray-800 border-b border-[#f0c4d0] outline-none px-1 py-0.5 w-24"
              />
            ) : (
              <button
                onClick={() => { setLabelDraft(selectedTable.label); setEditingLabel(true) }}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-[#d4728a] transition-colors group"
              >
                {selectedTable.label}
                <Pencil className="w-3 h-3 text-gray-300 group-hover:text-[#d4728a]" />
              </button>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => removeTable(selectedTable.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                title="删除此桌"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSelectedTableId(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-500 mb-3">
            {selectedTable.seats} 人桌 · 已坐 {tableGuests.length} 人 · 已确认 {tableGuests.filter(g => g.status === 'confirmed').length} 人
            <span className="ml-2 text-gray-400">拖拽可调整顺序</span>
          </div>

          {/* Seated guests - draggable */}
          <div className="space-y-1.5 mb-4">
            {Array.from({ length: selectedTable.seats }).map((_, i) => {
              const guest = tableGuests.find((g) => g.seatIndex === i)
              const isDragOver = dragOverIndex === i && dragIndex !== null && dragIndex !== i
              return (
                <div
                  key={i}
                  draggable={!!guest}
                  onDragStart={() => guest && setDragIndex(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i) }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    isDragOver ? 'ring-2 ring-[#d4728a] ring-offset-1' : ''
                  } ${
                    guest
                      ? guest.status === 'confirmed'
                        ? 'bg-[#f9e8ed] border border-[#f0c4d0] cursor-grab active:cursor-grabbing'
                        : 'bg-[#fdf5f7] border border-[#f5dde4] cursor-grab active:cursor-grabbing'
                      : 'bg-gray-50 border border-dashed border-gray-200'
                  } ${dragIndex === i ? 'opacity-50' : ''}`}
                >
                  {guest && <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  {guest ? (
                    <>
                      <span className={`flex-1 font-medium ${guest.status === 'confirmed' ? 'text-[#a34d63]' : 'text-gray-700'}`}>
                        {guest.name}
                      </span>
                      <button
                        onClick={() => handleToggleConfirm(guest.id, guest.status)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                          guest.status === 'confirmed'
                            ? 'bg-[#d4728a] text-white hover:bg-[#b85a72]'
                            : 'bg-gray-100 text-gray-500 hover:bg-[#f9e8ed] hover:text-[#a34d63]'
                        }`}
                      >
                        {guest.status === 'confirmed' ? '已确认' : '确认出席'}
                      </button>
                      <button
                        onClick={() => handleUnassign(guest.id)}
                        className="text-gray-400 hover:text-red-500 shrink-0"
                        title="移除"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-gray-300">空</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Assign button */}
          <button
            onClick={() => setShowAssign(!showAssign)}
            disabled={tableGuests.length >= selectedTable.seats || unassignedGuests.length === 0}
            className="flex items-center justify-center gap-1.5 px-3 py-2 border border-[#f0c4d0] text-[#d4728a] rounded-lg text-sm font-medium hover:bg-[#fdf5f7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-3"
          >
            <UserPlus className="w-4 h-4" /> 分配宾客
          </button>

          {/* Unassigned list */}
          {showAssign && (
            <div className="flex-1 border-t border-gray-100 pt-3">
              <h4 className="text-xs font-semibold text-gray-500 mb-2">待分配宾客</h4>
              <div className="space-y-1 overflow-y-auto max-h-60">
                {unassignedGuests.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleAssign(g.id)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-[#fdf5f7] transition-colors flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f0c4d0]" />
                    {g.name}
                    <span className="text-xs text-gray-400 ml-auto">{g.group}</span>
                  </button>
                ))}
                {unassignedGuests.length === 0 && (
                  <p className="text-xs text-gray-400 py-2">所有宾客都已分配</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
