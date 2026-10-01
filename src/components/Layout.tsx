import { useState } from 'react'
import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import {
  Users, LayoutGrid, BedDouble, NotebookPen, Heart, Pencil, UserPlus, Check,
  Wifi, WifiOff, FolderKey, Plus, Copy, ExternalLink, Trash2, ChevronDown,
} from 'lucide-react'
import { useWeddingStore } from '../stores/useWeddingStore'
import { useSupabaseSync } from '../hooks/useSupabaseSync'
import { isSupabaseConfigured } from '../lib/supabase'

const navItems = [
  { to: 'guests', label: '宾客名单', icon: Users },
  { to: 'seating', label: '座位安排', icon: LayoutGrid },
  { to: 'stay', label: '住宿安排', icon: BedDouble },
  { to: 'notes', label: '备婚笔记', icon: NotebookPen },
]

export default function Layout() {
  const {
    projectTitle, setProjectTitle, projectId: storedProjectId,
    sharedLinks, addSharedLink, renameSharedLink, removeSharedLink,
  } = useWeddingStore()
  const { projectId: urlProjectId } = useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // 使用 URL 中的 projectId，没有则用本地存储的默认 ID
  const projectId = urlProjectId || storedProjectId
  const isHome = !urlProjectId // 只有在自己的首页（链接不带 /p/）才显示「我的项目」

  // 启用 Supabase 实时同步
  const { isSyncing } = useSupabaseSync(projectId)

  const linkUrl = (id: string) => `${window.location.origin}/p/${id}`

  const handleSave = () => {
    if (draft.trim()) setProjectTitle(draft.trim())
    setEditing(false)
  }

  // 邀请协作：分享「当前项目」给家人一起编辑
  const handleInvite = () => {
    navigator.clipboard.writeText(linkUrl(projectId)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // 新建独立项目：只生成一条全新的空项目链接，不切换当前项目
  const handleMint = () => {
    const id = uuid().slice(0, 8)
    const name = newName.trim() || `朋友的项目 ${sharedLinks.length + 1}`
    addSharedLink({ id, name, createdAt: new Date().toISOString() })
    setNewName('')
    navigator.clipboard.writeText(linkUrl(id)).then(() => {
      setCopiedLinkId(id)
      setTimeout(() => setCopiedLinkId(null), 2000)
    })
  }

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(linkUrl(id)).then(() => {
      setCopiedLinkId(id)
      setTimeout(() => setCopiedLinkId(null), 2000)
    })
  }

  const commitRename = () => {
    if (renamingId && renameDraft.trim()) renameSharedLink(renamingId, renameDraft.trim())
    setRenamingId(null)
  }

  // 根据当前路径决定导航前缀
  const navPrefix = urlProjectId ? `/p/${urlProjectId}` : ''

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <button className="flex items-center gap-2" onClick={() => navigate('/seating')} title="回到我的首页">
          <Heart className="w-6 h-6 text-[#d4728a] fill-[#d4728a]" />
        </button>
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

        {!isHome && (
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">项目 #{urlProjectId}</span>
        )}

        <nav className="ml-6 flex gap-1">
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

        {/* Right side: sync + my-projects + invite */}
        <div className="ml-auto flex items-center gap-2">
          {isSupabaseConfigured && (
            <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
              isSyncing ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {isSyncing ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isSyncing ? '已同步' : '未连接'}
            </span>
          )}

          {isHome && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <FolderKey className="w-4 h-4" /> 我的项目
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-80 bg-white rounded-xl border border-gray-100 shadow-lg p-3">
                    <p className="text-xs text-gray-400 mb-2">为朋友新建独立项目：生成一条全新的空项目链接，数据与你隔离，发给谁谁就能用（他也能再分享给自己的家人协作）。</p>
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleMint()}
                        placeholder="备注名，如「小王婚礼」"
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-200"
                      />
                      <button
                        onClick={handleMint}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-[#d4728a] text-white hover:bg-[#c25f79] shrink-0"
                      >
                        <Plus className="w-4 h-4" /> 新建
                      </button>
                    </div>

                    {sharedLinks.length === 0 ? (
                      <p className="text-center text-xs text-gray-300 py-4">还没有生成过链接</p>
                    ) : (
                      <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                        {sharedLinks.map((l) => (
                          <li key={l.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[#faf9f7]">
                            <div className="min-w-0 flex-1">
                              {renamingId === l.id ? (
                                <input
                                  value={renameDraft}
                                  autoFocus
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  onBlur={commitRename}
                                  onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                                  className="w-full px-1.5 py-0.5 text-sm border border-[#f0c4d0] rounded focus:outline-none"
                                />
                              ) : (
                                <button
                                  onClick={() => { setRenamingId(l.id); setRenameDraft(l.name) }}
                                  className="block w-full text-left text-sm text-gray-800 font-medium truncate hover:text-[#d4728a]"
                                  title="点击改名"
                                >
                                  {l.name}
                                </button>
                              )}
                              <span className="text-[11px] text-gray-400">#{l.id}</span>
                            </div>
                            <button
                              onClick={() => copyLink(l.id)}
                              className="p-1.5 text-gray-400 hover:text-[#d4728a] rounded"
                              title={copiedLinkId === l.id ? '已复制' : '复制链接'}
                            >
                              {copiedLinkId === l.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => { setMenuOpen(false); navigate(`/p/${l.id}/seating`) }}
                              className="p-1.5 text-gray-400 hover:text-[#d4728a] rounded"
                              title="打开预览"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { if (confirm(`删除「${l.name}」这条链接记录？（不会删除对方项目里的数据）`)) removeSharedLink(l.id) }}
                              className="p-1.5 text-gray-300 hover:text-red-400 rounded"
                              title="从列表移除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={handleInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#d4728a] border border-[#f0c4d0] rounded-lg hover:bg-[#fdf5f7] transition-colors"
            title="把当前项目分享给家人，一起编辑"
          >
            {copied ? <Check className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {copied ? '已复制' : '邀请协作'}
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
