import FusionFieldEditor from '../fusion/FusionFieldEditor'
import { RepositoryContext } from '../fusion/RepositoryContext'
import { useState, useRef, useContext } from 'react'
import { useWeddingStore } from '../fusion/PageContext'
import { TABLE_PRESETS } from '../types'
import SeatingCanvas from '../components/seating/SeatingCanvas'
import { Download, Plus, Trash2, X, UserPlus, Pencil, GripVertical } from 'lucide-react'
import { ExportContext } from '../fusion/ExportContext'
import { exportSeatingChart } from '../utils/exportSeatingChart'

export default function SeatingPage() {
  const fusion = useContext(RepositoryContext)
  const { tables, guests, addTable, removeTable, updateTable, assignGuestToTable, swapGuestSeats, updateGuest, mainStagePos, projectTitle } = useWeddingStore()
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const stageRef = useRef<any>(null)
  // 画布视口状态（缩放到 SeatingPage 以便新增桌子时定位到视野中心）
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0, width: 800, height: 600 })

  const selectedTable = tables.find((t) => t.id === selectedTableId)
  const tableGuests = guests
    .filter((g) => g.tableId === selectedTableId)
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
  const unassignedGuests = guests.filter((g) => !g.tableId && g.attendance !== 'declined')

  const handleAddTable = (seats: number) => {
    // 在当前视野中心生成新桌子，避免添加到看不见的地方
    const centerX = (viewport.width / 2 - viewport.x) / viewport.scale
    const centerY = (viewport.height / 2 - viewport.y) / viewport.scale
    // 加一点随机偏移避免完全重叠
    const jitter = (tables.length % 5) * 30
    addTable(seats, centerX + jitter, centerY + jitter)
  }

  const openExport = useContext(ExportContext)
  const handleExport = () => {
    if (openExport) { openExport('seating'); return }
    const stage = stageRef.current
    if (!stage || tables.length === 0) return

    const getR = (seats: number) => TABLE_PRESETS.find((p) => p.seats === seats)?.radius ?? 60
    const margin = 100
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    tables.forEach((t) => {
      const r = getR(t.seats) + 45
      minX = Math.min(minX, t.x - r); minY = Math.min(minY, t.y - r)
      maxX = Math.max(maxX, t.x + r); maxY = Math.max(maxY, t.y + r)
    })
    // 纳入主舞台
    const msx = mainStagePos?.x ?? viewport.width / 2
    const msy = mainStagePos?.y ?? 40
    minX = Math.min(minX, msx - 140); maxX = Math.max(maxX, msx + 140)
    minY = Math.min(minY, msy); maxY = Math.max(maxY, msy + 60)

    const contentW = maxX - minX + margin * 2
    const contentH = maxY - minY + margin * 2
    const scale = Math.min(viewport.width / contentW, viewport.height / contentH, 1.5)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    const original = viewport
    const pixelRatio = 3
    // 先适配到内容，等渲染完成后导出合成高清图（含侧边信息面板），再恢复原视图
    setViewport({
      ...viewport,
      scale,
      x: viewport.width / 2 - cx * scale,
      y: viewport.height / 2 - cy * scale,
    })

    setTimeout(() => {
      const stageDataUrl = stage.toDataURL({ pixelRatio })
      const seated = guests.filter((g) => g.tableId).length
      const confirmed = guests.filter((g) => g.status === 'confirmed').length
      exportSeatingChart({
        stageDataUrl,
        chartWidth: viewport.width,
        chartHeight: viewport.height,
        pixelRatio,
        title: projectTitle,
        stats: {
          tables: tables.length,
          seats: tables.reduce((sum, t) => sum + t.seats, 0),
          seated,
          confirmed,
        },
        filename: `座位图_${new Date().toLocaleDateString('zh-CN')}.png`,
      })
      setViewport(original)
    }, 200)
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
    if (dragGuest && targetGuest && swapGuestSeats) swapGuestSeats(dragGuest.id, targetGuest.id)
    else {
      if (dragGuest) assignGuestToTable(dragGuest.id, selectedTable.id, targetIndex)
      if (targetGuest) assignGuestToTable(targetGuest.id, selectedTable.id, dragIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className={`${fusion ? 'planner-page ' : ''}h-full min-h-0 min-w-0 relative flex flex-col md:flex-row`}>
      <div className="md:hidden shrink-0 bg-white border-b p-2 space-y-2" aria-label="排座工具">
        <div className="flex flex-wrap gap-2">
          {TABLE_PRESETS.map(preset => <button key={preset.seats} onClick={() => handleAddTable(preset.seats)} className="border rounded px-3 py-2 text-sm">添加{preset.seats}人桌</button>)}
        </div>
        <div className="flex gap-2 items-center">
          <select aria-label="选择桌子" value={selectedTableId ?? ''} onChange={e => setSelectedTableId(e.target.value || null)} className="border rounded px-2 py-2 min-w-0 flex-1 text-sm">
            <option value="">选择桌子安排宾客（{tables.length} 桌）</option>
            {tables.map(table => <option key={table.id} value={table.id}>{table.label} · {guests.filter(g => g.tableId === table.id).length}/{table.seats} 人</option>)}
          </select>
          <button disabled={!tables.length} onClick={handleExport} className="border rounded px-3 py-2 text-sm disabled:opacity-40">导出 PNG</button>
        </div>
      </div>
      {/* Left panel */}
      <div className="hidden md:flex w-52 bg-white border-r border-gray-100 p-4 flex-col shrink-0 overflow-y-auto">
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
        viewport={viewport}
        onViewportChange={setViewport}
      />

      {/* Right panel */}
      {selectedTable && (
        <div className="absolute inset-x-0 bottom-0 z-30 max-h-[70%] md:static md:max-h-full md:w-72 bg-white border border-gray-100 p-4 flex flex-col shrink-0 overflow-y-auto shadow-lg md:shadow-none">
          {/* Table name - editable */}
          <div className="sticky top-0 z-10 bg-white flex items-center justify-between mb-4 py-1 shrink-0">
            {fusion ? <FusionFieldEditor key={selectedTable.id} kind="table" entityId={selectedTable.id} label="桌名" value={selectedTable.label} /> : editingLabel ? (
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
                onClick={() => { if (confirm(`删除“${selectedTable.label}”？桌上 ${tableGuests.length} 位宾客将移出座位，宾客记录和住宿安排保留。`)) removeTable(selectedTable.id) }}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                title="删除此桌"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSelectedTableId(null)}
                aria-label="关闭桌子详情"
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
