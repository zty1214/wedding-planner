import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useWeddingStore } from '../stores/useWeddingStore'
import type { Guest, Table, Note } from '../types'

/**
 * Supabase 双向同步 Hook
 * - 启动时从 Supabase 拉取数据
 * - 订阅实时变更，远端修改自动更新本地 store
 * - 本地 store 变更自动推送到 Supabase
 */
export function useSupabaseSync(projectId: string | null) {
  const syncing = useRef(false) // 防止循环同步
  const initialized = useRef(false)

  const { guests, tables, notes } = useWeddingStore()

  // 初始加载 + 实时订阅
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !supabase) return

    let mounted = true

    async function loadAndSubscribe() {
      // 拉取远端数据
      const [guestsRes, tablesRes, notesRes] = await Promise.all([
        supabase!.from('guests').select('*').eq('project_id', projectId),
        supabase!.from('tables').select('*').eq('project_id', projectId),
        supabase!.from('notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      ])

      if (!mounted) return
      syncing.current = true

      // 合并远端数据（以远端为准）
      if (guestsRes.data) {
        const remoteGuests: Guest[] = guestsRes.data.map((r: any) => ({
          id: r.id,
          name: r.name,
          group: r.group_name,
          phone: r.phone || undefined,
          notes: r.notes || undefined,
          tableId: r.table_id,
          seatIndex: r.seat_index,
          status: r.status || 'unassigned',
        }))
        useWeddingStore.setState({ guests: remoteGuests })
      }

      if (tablesRes.data) {
        const remoteTables: Table[] = tablesRes.data.map((r: any) => ({
          id: r.id,
          label: r.label,
          x: Number(r.x),
          y: Number(r.y),
          seats: r.seats,
          rotation: Number(r.rotation),
        }))
        useWeddingStore.setState({ tables: remoteTables })
      }

      if (notesRes.data) {
        const remoteNotes: Note[] = notesRes.data.map((r: any) => ({
          id: r.id,
          category: r.category,
          title: r.title || '',
          content: r.content || '',
          images: r.images || [],
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
        useWeddingStore.setState({ notes: remoteNotes })
      }

      syncing.current = false
      initialized.current = true

      // 订阅实时变更
      const channel = supabase!
        .channel(`project-${projectId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: `project_id=eq.${projectId}` }, (payload) => {
          if (syncing.current) return
          const store = useWeddingStore.getState()
          if (payload.eventType === 'INSERT') {
            const r = payload.new as any
            const exists = store.guests.find(g => g.id === r.id)
            if (!exists) {
              useWeddingStore.setState({
                guests: [...store.guests, {
                  id: r.id, name: r.name, group: r.group_name,
                  phone: r.phone, notes: r.notes, tableId: r.table_id,
                  seatIndex: r.seat_index, status: r.status || 'unassigned',
                }]
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({
              guests: store.guests.map(g => g.id === r.id ? {
                ...g, name: r.name, group: r.group_name, phone: r.phone,
                notes: r.notes, tableId: r.table_id, seatIndex: r.seat_index, status: r.status || 'unassigned',
              } : g)
            })
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as any
            useWeddingStore.setState({ guests: store.guests.filter(g => g.id !== r.id) })
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `project_id=eq.${projectId}` }, (payload) => {
          if (syncing.current) return
          const store = useWeddingStore.getState()
          if (payload.eventType === 'INSERT') {
            const r = payload.new as any
            const exists = store.tables.find(t => t.id === r.id)
            if (!exists) {
              useWeddingStore.setState({
                tables: [...store.tables, {
                  id: r.id, label: r.label, x: Number(r.x), y: Number(r.y),
                  seats: r.seats, rotation: Number(r.rotation),
                }]
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({
              tables: store.tables.map(t => t.id === r.id ? {
                ...t, label: r.label, x: Number(r.x), y: Number(r.y),
                seats: r.seats, rotation: Number(r.rotation),
              } : t)
            })
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as any
            useWeddingStore.setState({ tables: store.tables.filter(t => t.id !== r.id) })
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `project_id=eq.${projectId}` }, (payload) => {
          if (syncing.current) return
          const store = useWeddingStore.getState()
          if (payload.eventType === 'INSERT') {
            const r = payload.new as any
            const exists = store.notes.find(n => n.id === r.id)
            if (!exists) {
              useWeddingStore.setState({
                notes: [{
                  id: r.id, category: r.category, title: r.title || '',
                  content: r.content || '', images: r.images || [],
                  createdAt: r.created_at, updatedAt: r.updated_at,
                }, ...store.notes]
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({
              notes: store.notes.map(n => n.id === r.id ? {
                ...n, category: r.category, title: r.title || '',
                content: r.content || '', images: r.images || [],
                updatedAt: r.updated_at,
              } : n)
            })
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as any
            useWeddingStore.setState({ notes: store.notes.filter(n => n.id !== r.id) })
          }
        })
        .subscribe()

      return () => {
        supabase!.removeChannel(channel)
      }
    }

    const cleanup = loadAndSubscribe()
    return () => {
      mounted = false
      cleanup.then(fn => fn?.())
    }
  }, [projectId])

  // 本地变更推送到远端
  const prevGuests = useRef(guests)
  const prevTables = useRef(tables)
  const prevNotes = useRef(notes)

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !supabase || !initialized.current || syncing.current) return
    const db = supabase

    // 检测 guests 变更
    const prevG = prevGuests.current
    if (guests !== prevG) {
      // 找出新增、修改、删除
      const prevIds = new Set(prevG.map(g => g.id))
      const currIds = new Set(guests.map(g => g.id))

      const added = guests.filter(g => !prevIds.has(g.id))
      const removed = prevG.filter(g => !currIds.has(g.id))
      const updated = guests.filter(g => {
        const prev = prevG.find(p => p.id === g.id)
        return prev && JSON.stringify(prev) !== JSON.stringify(g)
      })

      if (added.length) {
        db.from('guests').insert(added.map(g => ({
          id: g.id, project_id: projectId, name: g.name, group_name: g.group,
          phone: g.phone || null, notes: g.notes || null,
          table_id: g.tableId, seat_index: g.seatIndex, status: g.status,
        }))).then()
      }
      if (removed.length) {
        db.from('guests').delete().in('id', removed.map(g => g.id)).then()
      }
      if (updated.length) {
        updated.forEach(g => {
          db.from('guests').update({
            name: g.name, group_name: g.group, phone: g.phone || null,
            notes: g.notes || null, table_id: g.tableId, seat_index: g.seatIndex, status: g.status,
          }).eq('id', g.id).then()
        })
      }
    }

    // 检测 tables 变更
    const prevT = prevTables.current
    if (tables !== prevT) {
      const prevIds = new Set(prevT.map(t => t.id))
      const currIds = new Set(tables.map(t => t.id))

      const added = tables.filter(t => !prevIds.has(t.id))
      const removed = prevT.filter(t => !currIds.has(t.id))
      const updated = tables.filter(t => {
        const prev = prevT.find(p => p.id === t.id)
        return prev && JSON.stringify(prev) !== JSON.stringify(t)
      })

      if (added.length) {
        db.from('tables').insert(added.map(t => ({
          id: t.id, project_id: projectId, label: t.label,
          x: t.x, y: t.y, seats: t.seats, rotation: t.rotation,
        }))).then()
      }
      if (removed.length) {
        db.from('tables').delete().in('id', removed.map(t => t.id)).then()
      }
      if (updated.length) {
        updated.forEach(t => {
          db.from('tables').update({
            label: t.label, x: t.x, y: t.y, seats: t.seats, rotation: t.rotation,
          }).eq('id', t.id).then()
        })
      }
    }

    // 检测 notes 变更
    const prevN = prevNotes.current
    if (notes !== prevN) {
      const prevIds = new Set(prevN.map(n => n.id))
      const currIds = new Set(notes.map(n => n.id))

      const added = notes.filter(n => !prevIds.has(n.id))
      const removed = prevN.filter(n => !currIds.has(n.id))

      if (added.length) {
        db.from('notes').insert(added.map(n => ({
          id: n.id, project_id: projectId, category: n.category,
          title: n.title, content: n.content, images: n.images,
        }))).then()
      }
      if (removed.length) {
        db.from('notes').delete().in('id', removed.map(n => n.id)).then()
      }
    }

    prevGuests.current = guests
    prevTables.current = tables
    prevNotes.current = notes
  }, [guests, tables, notes, projectId])

  return { isSyncing: isSupabaseConfigured && !!projectId }
}
