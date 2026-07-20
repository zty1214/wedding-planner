import { useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Users, LayoutGrid, NotebookPen, Heart, Pencil, Share2, Check, Wifi, WifiOff } from 'lucide-react'
import { useWeddingStore } from '../stores/useWeddingStore'
import { useSupabaseSync } from '../hooks/useSupabaseSync'
import { isSupabaseConfigured } from '../lib/supabase'

const navItems = [
  { to: 'guests', label: '宾客名单', icon: Users },
  { to: 'seating', label: '座位安排', icon: LayoutGrid },
  { to: 'notes', label: '备婚笔记', icon: NotebookPen },
]

export default function Layout() {
  const { projectTitle, setProjectTitle, projectId: storedProjectId } = useWeddingStore()
  const { projectId: urlProjectId } = useParams()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)

  // 使用 URL 中的 projectId，没有则用本地存储的默认 ID
  const projectId = urlProjectId || storedProjectId

  // 启用 Supabase 实时同步
  const { isSyncing } = useSupabaseSync(projectId)

  const handleSave = () => {
    if (draft.trim()) setProjectTitle(draft.trim())
    setEditing(false)
  }

  const handleShare = () => {
    const base = window.location.origin
    const shareUrl = `${base}/p/${projectId}`
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // 根据当前路径决定导航前缀
  const navPrefix = urlProjectId ? `/p/${urlProjectId}` : ''

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <Heart className="w-6 h-6 text-[#d4728a] fill-[#d4728a]" />
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            onBlur={handleSave}
            autoFocus
            className="text-lg font-semibold text-gray-800 border-b-2 border-[#f0c4d0] outline-none px-1 py-0 w-40"
          />
        ) : (
          <button
            onClick={() => { setDraft(projectTitle); setEditing(true) }}
            className="flex items-center gap-1.5 group"
            title="点击修改标题"
          >
            <h1 className="text-lg font-semibold text-gray-800">{projectTitle}</h1>
            <Pencil className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        <nav className="ml-8 flex gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={`${navPrefix}/${to}`}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#fdf5f7] text-[#d4728a]'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Right side: sync status + share */}
        <div className="ml-auto flex items-center gap-2">
          {isSupabaseConfigured && (
            <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
              isSyncing ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {isSyncing ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isSyncing ? '已同步' : '未连接'}
            </span>
          )}
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#d4728a] border border-[#f0c4d0] rounded-lg hover:bg-[#fdf5f7] transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            {copied ? '已复制' : '分享链接'}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
