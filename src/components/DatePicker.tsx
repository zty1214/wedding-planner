import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * 轻量自绘日历弹层：可翻月、点任意一天，返回 'YYYY-MM-DD'。
 * 用于替代原生 <input type="date">（原生在部分浏览器选完月份后无法继续选日）。
 */
export default function DatePicker({
  onSelect,
  onClose,
}: {
  onSelect: (iso: string) => void
  onClose: () => void
}) {
  const today = new Date()
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() })

  const firstWeekday = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const shift = (delta: number) => {
    const m = view.month + delta
    const y = view.year + Math.floor(m / 12)
    const mm = ((m % 12) + 12) % 12
    setView({ year: y, month: mm })
  }

  const pick = (d: number) => {
    onSelect(`${y2(view.year)}-${pad(view.month + 1)}-${pad(d)}`)
    onClose()
  }

  return (
    <div className="absolute z-40 mt-1 left-0 bg-white rounded-xl border border-gray-100 shadow-lg p-3 w-64" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="p-1 text-gray-400 hover:text-[#d4728a] rounded">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700">{view.year} 年 {view.month + 1} 月</span>
        <button onClick={() => shift(1)} className="p-1 text-gray-400 hover:text-[#d4728a] rounded">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] text-gray-400 py-1">{w}</div>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              onClick={() => pick(d)}
              className="text-sm py-1.5 rounded-lg text-gray-700 hover:bg-[#d4728a] hover:text-white transition-colors"
            >
              {d}
            </button>
          )
        )}
      </div>
    </div>
  )
}

function y2(year: number) {
  return String(year)
}
