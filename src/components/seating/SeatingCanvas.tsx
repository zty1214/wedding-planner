import { useState, useCallback } from 'react'
import { Stage, Layer, Circle, Text, Group, Rect } from 'react-konva'
import { useWeddingStore } from '../../stores/useWeddingStore'
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

interface Props {
  selectedTableId: string | null
  onSelectTable: (id: string | null) => void
  stageRef: React.RefObject<any>
}

export default function SeatingCanvas({ selectedTableId, onSelectTable, stageRef }: Props) {
  const { tables, guests, updateTable } = useWeddingStore()
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const rect = node.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
  }, [])

  const getTableGuests = (tableId: string) =>
    guests.filter((g) => g.tableId === tableId).sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))

  const getRadius = (seats: number) =>
    TABLE_PRESETS.find((p) => p.seats === seats)?.radius ?? 60

  const stageWidth = Math.min(stageSize.width * 0.35, 260)
  const stageX = stageSize.width / 2
  const stageY = 40

  return (
    <div ref={measureRef} className="flex-1 relative bg-[#faf9f7] overflow-hidden">
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
        width={stageSize.width}
        height={stageSize.height}
        onClick={(e) => {
          if (e.target === e.target.getStage()) onSelectTable(null)
        }}
        className="relative z-10"
      >
        <Layer>
          {/* Main Stage - soft rose, no border, text centered */}
          <Group x={stageX} y={stageY}>
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
            fontSize={120}
            fill={COLORS.primary}
            opacity={0.05}
            align="center"
            x={stageSize.width / 2 - 60}
            y={stageSize.height - 150}
            width={120}
          />
          <Text
            text="百年好合 · 永结同心"
            fontSize={13}
            fill="#c4a898"
            opacity={0.35}
            align="center"
            x={0}
            y={stageSize.height - 36}
            width={stageSize.width}
            letterSpacing={2}
          />
        </Layer>
      </Stage>

      {tables.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <p className="text-gray-400 text-sm mt-20">从左侧点击桌子添加到画布，自由拖拽排列</p>
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
        const displayText = guest ? guest.name.slice(0, 3) : '空'

        return (
          <Group key={i} x={sx} y={sy}>
            <Circle
              radius={15}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1.5}
            />
            {/* Text centered: x=-r, y=-r, width=2r, height=2r */}
            <Text
              text={displayText}
              fontSize={guest ? 9 : 8}
              fontStyle={guest ? 'bold' : 'normal'}
              fill={textColor}
              align="center"
              verticalAlign="middle"
              x={-15}
              y={-15}
              width={30}
              height={30}
            />
          </Group>
        )
      })}
    </Group>
  )
}
