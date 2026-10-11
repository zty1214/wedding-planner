import { useRef, useState } from 'react'
import type { Room } from '../types'
import { formatNight } from '../utils/date'
import { useWeddingStore } from './PageContext'

/** Each click persists one atomic room-wide date change through the normal outbox. */
export default function FusionRoomDates({ room, dates }: { room: Room; dates: string[] }) {
  const arrangeRoom = useWeddingStore(state => state.arrangeRoom)
  const saving = useRef(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function toggle(date: string) {
    if (saving.current || !arrangeRoom) return
    const selected = room.stayDates ?? []
    const next = selected.includes(date) ? selected.filter(value => value !== date) : [...selected, date].sort()
    saving.current = true; setBusy(true); setMessage('')
    try {
      if (!await arrangeRoom(room.id, [], next)) setMessage('日期未能保存，请核对顶部提示与本机草稿后重试。')
    } catch { setMessage('日期未能保存，请核对顶部提示与本机草稿后重试。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <div className="planner-room-dates space-y-1" role="group" aria-label={`${room.label}住宿晚次`}>
    <div className="flex items-center flex-wrap gap-1.5"><span className="text-xs text-gray-500">住宿晚次</span>
      {dates.map(date => <button key={date} type="button" title={date} aria-label={`${room.label}住宿${date}`} aria-pressed={room.stayDates?.includes(date) ?? false} disabled={busy}
        className={`text-xs px-2 py-1 rounded-lg border ${room.stayDates?.includes(date) ? 'bg-[#d4728a] text-white border-transparent' : 'bg-white text-gray-500 border-gray-200'}`}
        onClick={() => void toggle(date)}>{formatNight(date)}</button>)}
    </div>
    {!dates.length ? <p className="text-xs text-gray-500">先在上方添加日期</p> : !room.stayDates?.length && <p className="text-xs text-gray-500">晚次待定；点选日期，同房宾客共用。</p>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>
}
