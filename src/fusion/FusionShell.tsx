import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { BedDouble, Flower2, Heart, LayoutGrid, MoreHorizontal, NotebookPen, Users, FolderHeart } from 'lucide-react'
import './fusion-theme.css'

const navigation = [
  { path: 'guests', label: '宾客名单', icon: Users },
  { path: 'seating', label: '座位安排', icon: LayoutGrid },
  { path: 'stay', label: '住宿安排', icon: BedDouble },
  { path: 'notes', label: '备婚笔记', icon: NotebookPen },
]

type Props = { projectId: string; title: ReactNode; status: ReactNode; state: string; actions: ReactNode; resume: ReactNode; children: ReactNode }

/** Presentation only: actual repository state and all actions stay with ProjectView. */
export default function FusionShell({ projectId, title, status, state, actions, resume, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setMenuOpen(false); menuButton.current?.focus() }
    }
    const outside = (event: PointerEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !menuButton.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside) }
  }, [menuOpen])
  return <div className="planner-shell">
    <aside className="planner-sidebar" aria-label="项目工作台">
      <a className="planner-brand" href="/fusion"><Flower2 size={28} /><span>喜事<small>A LITTLE FOREVER</small></span></a>
      <div className="planner-side-caption"><span>OUR WEDDING</span><p>把重要的人，<br />放在心上。</p></div>
        <nav className="planner-navigation" aria-label="项目页面">{navigation.map(({ path, label, icon: Icon }) => <NavLink key={path} to={`/fusion/p/${projectId}/${path}`} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
        <div ref={menu} id="planner-project-actions" className={`planner-actions${menuOpen ? ' is-open' : ''}`}>
          <nav aria-label="项目辅助页面"><a href="/fusion">我的项目</a>{[['history', '历史版本'], ['recycle', '回收站']].map(([path, label]) => <NavLink key={path} to={`/fusion/p/${projectId}/${path}`} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'is-active' : ''}>{label}</NavLink>)}</nav>
          {actions}
        </div>
      <div className="planner-side-bottom"><Heart size={18} /><p>把琐碎的准备，<br />留给相聚的美好。</p><a href="/fusion"><FolderHeart size={18} />返回项目列表</a></div>
    </aside>
    <div className="planner-workspace">
      <header className="planner-header" data-state={state}>
        <div className="planner-project-title">{title}</div>
        <div className="planner-header-status"><span role="status" className="planner-sync" data-state={state}><i aria-hidden="true" />{status}</span>{resume}</div>
        <button ref={menuButton} className="planner-more" aria-label="更多操作" aria-expanded={menuOpen} aria-controls="planner-project-actions" onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={20} /><span>更多操作</span></button>

      </header>
      {children}
    </div>
  </div>
}
