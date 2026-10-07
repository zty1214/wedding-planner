import { useCallback, useLayoutEffect, useRef } from 'react'
import { Stage, Layer, Circle, Text, Group, Rect } from 'react-konva'
import { ZoomIn, ZoomOut, Locate } from 'lucide-react'
import { useWeddingStore } from '../../fusion/PageContext'
import { seatNameLayout } from '../../utils/seatName'
import { TABLE_PRESETS } from '../../types'
import type { Table, Guest } from '../../types'

// Softer rose palette
const COLORS = {
  primary: '#d4728a',
  primaryDark: '#b85a72',
  primaryLight: '#fdf5f7',
  primaryBorder: '#f0c4d0',
  confirmedFill: '#d4728a',
  confirmedStroke: '#b85a72',
  assignedFill: '#fdf5f7',
  assignedStroke: '#f0c4d0',
  assignedText: '#a34d63',
  emptyFill: '#f7f6f5',
  emptyStroke: '#ddd9d5',
  emptyText: '#b0aaa4',
  tableFill: '#fffef9',
  tableStroke: '#ddd9d5',
  tableLabel: '#5a4a3e',
  tableSub: '#b0a498',
}

interface Viewport {
  scale: number
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  fixedData?: { tables: Table[]; guests: Guest[]; mainStagePos: { x: number; y: number } | null }
  selectedTableId: string | null
  onSelectTable: (id: string | null) => void
  stageRef: React.RefObject<any>
  viewport: Viewport
  onViewportChange: (v: Viewport) => void
}

export default function SeatingCanvas({ selectedTableId, onSelectTable, stageRef, viewport, onViewportChange, fixedData }: Props) {
  const live = useWeddingStore()
  const { tables, guests, mainStagePos } = fixedData ?? live
  const { updateTable, setMainStagePos } = live
  const { scale: stageScale, x: posX, y: posY, width: stageW, height: stageH } = viewport

  const latestViewport = useRef({ viewport, onViewportChange })
  useLayoutEffect(() => { latestViewport.current = { viewport, onViewportChange } }, [viewport, onViewportChange])
  const fixed = !!fixedData
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || fixed) return
    const measure = () => {
      const { viewport: current, onViewportChange: change } = latestViewport.current
      const { width, height } = node.getBoundingClientRect()
      if (width > 0 && height > 0 && (current.width !== width || current.height !== height)) change({ ...current, width, height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node); measure()
    return () => observer.disconnect()
  }, [fixed])

  const getTableGuests = (tableId: string) =>
    guests.filter((g) => g.tableId === tableId).sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))

  const getRadius = (seats: number) =>
    TABLE_PRESETS.find((p) => p.seats === seats)?.radius ?? 60

  const stageWidth = Math.min(stageW * 0.35, 260)
  // 主舞台位置：优先用存储的位置，否则默认居中
  const stageX = mainStagePos?.x ?? stageW / 2
  const stageY = mainStagePos?.y ?? 40

  // 滚轮缩放（以鼠标位置为中心）
  const handleWheel = (e: any) => {
    e.evt.preventDefault()
    const scaleBy = 1.08
    const stage = stageRef.current
    if (!stage) return
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = Math.min(Math.max(oldScale * Math.pow(scaleBy, direction), 0.2), 3)
    onViewportChange({
      ...viewport,
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }

  const zoomBy = (factor: number) => {
    const newScale = Math.min(Math.max(stageScale * factor, 0.2), 3)
    const centerX = stageW / 2
    const centerY = stageH / 2
    const pointTo = {
      x: (centerX - posX) / stageScale,
      y: (centerY - posY) / stageScale,
    }
    onViewportChange({
      ...viewport,
      scale: newScale,
      x: centerX - pointTo.x * newScale,
      y: centerY - pointTo.y * newScale,
    })
  }

  // 定位所有桌子：计算包围盒并居中适配（只看桌子，不含主舞台，确保能找到丢失的桌子）
  const fitToView = () => {
    if (tables.length === 0) {
      onViewportChange({ ...viewport, scale: 1, x: 0, y: 0 })
      return
    }
    const margin = 100
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    tables.forEach((t) => {
      const r = getRadius(t.seats) + 45
      minX = Math.min(minX, t.x - r)
      minY = Math.min(minY, t.y - r)
      maxX = Math.max(maxX, t.x + r)
      maxY = Math.max(maxY, t.y + r)
    })

    const contentW = maxX - minX + margin * 2
    const contentH = maxY - minY + margin * 2
    const scale = Math.min(stageW / contentW, stageH / contentH, 1.5)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    onViewportChange({
      ...viewport,
      scale,
      x: stageW / 2 - centerX * scale,
      y: stageH / 2 - centerY * scale,
    })
  }

  return (
    <div ref={measureRef} className="flex-1 min-w-0 min-h-0 relative bg-[#faf9f7] overflow-hidden">
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(circle, #d8d2cc 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        scaleX={stageScale}
        scaleY={stageScale}
        x={posX}
        y={posY}
        draggable={!fixedData}
        listening={!fixedData}
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // 只有拖拽的是 Stage 本身（空白处）才更新平移位置
          if (e.target === e.target.getStage()) {
            onViewportChange({ ...viewport, x: e.target.x(), y: e.target.y() })
          }
        }}
        onClick={(e) => {
          if (e.target === e.target.getStage()) onSelectTable(null)
        }}
        className="relative z-10"
      >
        <Layer>
          {/* 背景底布：覆盖当前可视区域，导出时带底色（listening=false 不阻挡交互） */}
          <Rect
            x={-posX / stageScale}
            y={-posY / stageScale}
            width={stageW / stageScale}
            height={stageH / stageScale}
            fill="#faf9f7"
            listening={false}
          />
          {/* Main Stage - soft rose, no border, text centered, draggable */}
          <Group
            x={stageX}
            y={stageY}
            draggable
            onDragEnd={(e) => setMainStagePos({ x: e.target.x(), y: e.target.y() })}
          >
            <Rect
              x={-stageWidth / 2}
              y={0}
              width={stageWidth}
              height={50}
              cornerRadius={10}
              fill={COLORS.primary}
              shadowColor="rgba(212,114,138,0.25)"
              shadowBlur={12}
              shadowOffsetY={4}
            />
            {/* Text centered: position at rect top-left, size = rect size, align center */}
            <Text
              text="主 舞 台"
              fontSize={16}
              fill="#ffffff"
              align="center"
              verticalAlign="middle"
              x={-stageWidth / 2}
              y={0}
              width={stageWidth}
              height={50}
              letterSpacing={6}
            />
          </Group>

          {/* Tables */}
          {tables.map((table) => (
            <TableNode
              key={table.id}
              table={table}
              isSelected={table.id === selectedTableId}
              guests={getTableGuests(table.id)}
              radius={getRadius(table.seats)}
              onSelect={() => onSelectTable(table.id)}
              onDragEnd={(x, y) => updateTable(table.id, { x, y })}
            />
          ))}

          {/* Bottom watermark */}
          <Text
            text="囍"
            fontSize={200}
            fill={COLORS.primary}
            opacity={0.08}
            align="center"
            x={stageW / 2 - 100}
            y={stageH - 240}
            width={200}
          />
          <Text
            text="百年好合 · 永结同心"
            fontSize={13}
            fill="#c4a898"
            opacity={0.35}
            align="center"
            x={0}
            y={stageH - 36}
            width={stageW}
            letterSpacing={2}
          />
        </Layer>
      </Stage>

      {/* Floating zoom controls */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 bg-white rounded-lg border border-gray-200 shadow-sm px-1.5 py-1">
        <button
          onClick={() => zoomBy(1 / 1.25)}
          className="p-1.5 text-gray-500 hover:text-[#d4728a] hover:bg-[#fdf5f7] rounded transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500 w-10 text-center select-none">{Math.round(stageScale * 100)}%</span>
        <button
          onClick={() => zoomBy(1.25)}
          className="p-1.5 text-gray-500 hover:text-[#d4728a] hover:bg-[#fdf5f7] rounded transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <button
          onClick={fitToView}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-[#d4728a] hover:bg-[#fdf5f7] rounded transition-colors"
          title="定位所有桌子"
        >
          <Locate className="w-3.5 h-3.5" /> 定位
        </button>
      </div>

      {tables.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <p className="text-gray-400 text-sm mt-20">点击添加桌子，再在画布中拖拽排列</p>
        </div>
      )}
    </div>
  )
}

function TableNode({
  table,
  isSelected,
  guests,
  radius,
  onSelect,
  onDragEnd,
}: {
  table: Table
  isSelected: boolean
  guests: Guest[]
  radius: number
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
}) {
  const seatRadius = radius + 24
  const seats = table.seats

  return (
    <Group
      x={table.x}
      y={table.y}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
    >
      {/* Selection ring */}
      {isSelected && (
        <Circle radius={radius + 42} stroke={COLORS.primary} strokeWidth={1.5} dash={[6, 4]} opacity={0.5} />
      )}

      {/* Table circle */}
      <Circle
        radius={radius}
        fill={COLORS.tableFill}
        stroke={isSelected ? COLORS.primary : COLORS.tableStroke}
        strokeWidth={isSelected ? 2 : 1.5}
        shadowColor="rgba(0,0,0,0.06)"
        shadowBlur={8}
        shadowOffsetY={2}
      />

      {/* Table label - centered */}
      <Text
        text={table.label}
        fontSize={13}
        fontStyle="bold"
        fill={COLORS.tableLabel}
        align="center"
        verticalAlign="middle"
        x={-radius}
        y={-10}
        width={radius * 2}
        height={20}
      />
      <Text
        text={`${guests.length}/${seats}人`}
        fontSize={11}
        fill={COLORS.tableSub}
        align="center"
        verticalAlign="middle"
        x={-radius}
        y={8}
        width={radius * 2}
        height={16}
      />

      {/* Seats */}
      {Array.from({ length: seats }).map((_, i) => {
        const angle = (2 * Math.PI * i) / seats - Math.PI / 2
        const sx = Math.cos(angle) * seatRadius
        const sy = Math.sin(angle) * seatRadius
        const guest = guests.find((g) => g.seatIndex === i)
        const isConfirmed = guest?.status === 'confirmed'
        const isAssigned = guest?.status === 'assigned'

        const fillColor = isConfirmed ? COLORS.confirmedFill : isAssigned ? COLORS.assignedFill : COLORS.emptyFill
        const strokeColor = isConfirmed ? COLORS.confirmedStroke : isAssigned ? COLORS.assignedStroke : COLORS.emptyStroke
        const textColor = isConfirmed ? '#ffffff' : isAssigned ? COLORS.assignedText : COLORS.emptyText
        const name = guest ? seatNameLayout(guest.name) : { text: '空', fontSize: 10 }

        return (
          <Group key={i} x={sx} y={sy}>
            <Circle
              radius={16}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1.5}
            />
            {/* Text centered: x=-r, y=-r, width=2r, height=2r */}
            <Text
              text={name.text}
              fontSize={name.fontSize}
              fontStyle={guest ? 'bold' : 'normal'}
              fill={textColor}
              align="center"
              verticalAlign="middle"
              x={-16}
              y={-16}
              width={32}
              height={32}
              lineHeight={1.1}
            />
          </Group>
        )
      })}
    </Group>
  )
}
