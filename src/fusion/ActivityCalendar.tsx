import { useContext, useEffect, useState } from 'react'
import { RepositoryContext } from './RepositoryContext'
import { activityCategories, activityChanges } from './activity'
import type { ActivityMonth, SnapshotState } from './activity'
const categories = { guests: '宾客', seating: '排座', stay: '住宿', notes: '笔记', layout: '布局', project: '项目', unclassified: '历史未分类' }
const changes = { added: '新增', adjusted: '调整', deleted: '删除或清除', restored: '恢复', unclassified: '历史未分类' }
const snapshotLabels: Record<SnapshotState, string> = {
  today: '今天尚未封存，每日快照将在次日生成。', ready: '自动快照已生成，可在下方预览。', expired: '自动快照已过 90 天保留期，不能恢复。',
  pending: '有已同步活动，尚无可用自动快照：可能待生成、待重试或早于自动快照启用日期。', failed: '自动快照生成失败，后台将重试；当前已同步数据仍保留。', none: '这一天没有已记录活动，也没有自动快照。',
}
export default function ActivityCalendar({ selected, onSelect, reload }: { selected: string | null; onSelect(day: string | null): void; reload: number }) {
  const repo = useContext(RepositoryContext)!
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()))
  const [data, setData] = useState<ActivityMonth | null>(null), [error, setError] = useState(false)
  useEffect(() => {
    let stopped = false
    setData(null); setError(false)
    void repo.readActivityMonth(month).then(value => { if (!stopped) setData(value) }).catch(() => { if (!stopped) setError(true) })
    return () => { stopped = true }
  }, [repo, month, reload])
  const detail = data?.days.find(d => d.activity.day === selected)
  return <section className="border rounded bg-white p-4 space-y-3" aria-label="筹备日历">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">筹备日历</h2>
      <label>月份 <input aria-label="筹备月份" type="month" min="2000-01" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setMonth(e.target.value); onSelect(null) } }} className="border rounded p-1" /></label>
      <button className="text-rose-600" onClick={() => onSelect(null)}>查看所有版本</button>
    </div>
    <p className="text-sm text-gray-600">颜色表示全项目当天已同步的操作次数，不代表完成度或个人贡献。本机未同步草稿不计入。</p>
    {error ? <p role="alert">日历读取失败，请使用上方刷新按钮重试。</p> : !data ? <p role="status">正在读取日历…</p> : <>
      <div className="grid grid-cols-7 gap-1" aria-label={`${month} 每日操作次数`}>
        {['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day} className="text-center text-sm">{day}</span>)}
        {Array.from({ length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <span key={`blank-${i}`} />)}
        {data.days.map(({ activity: a }) => <button key={a.day} disabled={a.day > data.today} aria-pressed={a.day === selected}
          aria-label={`${a.day}，${a.count} 次已同步操作`} onClick={() => onSelect(a.day)}
          className={`rounded p-1 min-h-12 border text-xs disabled:opacity-30 ${a.day === selected ? 'ring-2 ring-rose-600' : ''} ${a.count >= 20 ? 'bg-rose-700 text-white' : a.count >= 5 ? 'bg-rose-300' : a.count ? 'bg-rose-100' : 'bg-gray-50'}`}>
          <span className="block">{Number(a.day.slice(-2))}</span>{a.count} 次
        </button>)}
      </div>
      <p className="text-xs text-gray-500">浅 → 深：0 / 1–4 / 5–19 / 20 次及以上。按上海时间统计。</p>
      {detail && <div aria-live="polite" className="border-t pt-3 space-y-2">
        <h3 className="font-semibold">{selected} · {detail.activity.count} 次操作</h3>
        <p>{snapshotLabels[detail.snapshot]}</p>
        <p className="text-sm">{activityCategories.filter(k => detail.activity.categories[k]).map(k => `${categories[k]} ${detail.activity.categories[k]} 次`).join(' · ') || '无活动记录'}</p>
        <p className="text-sm">{activityChanges.filter(k => detail.activity.changes[k]).map(k => `${changes[k]} ${detail.activity.changes[k]} 次`).join(' · ')}</p>
        <p className="text-sm text-gray-500">累计涉及宾客 {detail.activity.affectedGuests} 人次（同一个人多次调整会重复计入；历史未分类记录没有人数明细）。下方只列该日版本，不提供逐次修改日志。</p>
      </div>}
    </>}
  </section>
}
