import { useRef, useState } from 'react'
import { guestStays, stayInRoom } from './guestStays'
import type { Guest } from '../types'
import { formatNight } from '../utils/date'
import { useWeddingStore } from './PageContext'

/** Each click updates this guest only through the durable outbox. */
export default function FusionGuestDates({ guest, dates, roomId }: { guest: Guest; dates: string[]; roomId: string }) {
  const setGuestStayDates = useWeddingStore(state => state.setGuestStayDates)
  const saving = useRef(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const selected = stayInRoom(guest, roomId)?.dates ?? []
  const elsewhere = new Set(guestStays(guest).filter(stay => stay.roomId !== roomId).flatMap(stay => stay.dates))
  async function toggle(date: string) {
    if (saving.current || elsewhere.has(date)) return
    const next = selected.includes(date) ? selected.filter(value => value !== date) : [...selected, date].sort()
    saving.current = true; setBusy(true); setMessage('')
    try {
      if (!await setGuestStayDates(guest.id, next, roomId)) setMessage('日期未能保存，请核对顶部提示与本机草稿后重试。')
    } catch { setMessage('日期未能保存，请核对顶部提示与本机草稿后重试。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <div className="planner-room-dates space-y-1" role="group" aria-label={`${guest.name}住宿晚次`}>
    <div className="flex items-center flex-wrap gap-1.5"><span className="text-xs text-gray-500">住宿晚次</span>
      {dates.map(date => <button key={date} type="button" title={elsewhere.has(date) ? `${date} 已安排在其他房间` : date} aria-label={`${guest.name}住宿${date}`} aria-pressed={selected.includes(date)} disabled={busy || elsewhere.has(date)}
        className={`text-xs px-2 py-1 rounded-lg border disabled:opacity-50 ${selected.includes(date) ? 'bg-[#d4728a] text-white border-transparent' : 'bg-white text-gray-500 border-gray-200'}`}
        onClick={() => void toggle(date)}>{formatNight(date)}</button>)}
    </div>
    {!dates.length ? <p className="text-xs text-gray-500">先在上方添加日期</p> : !selected.length && <p className="text-xs text-gray-500">晚次待定，点击日期选择。</p>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>
}
