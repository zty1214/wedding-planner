import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useWeddingStore } from '../stores/useWeddingStore'
import type { Guest, Table, Note, Room } from '../types'

/**
 * Supabase 双向同步 Hook
 * - 启动时从 Supabase 拉取数据
 * - 订阅实时变更，远端修改自动更新本地 store
 * - 本地 store 变更自动推送到 Supabase
 */
export function useSupabaseSync(projectId: string | null) {
  const syncing = useRef(false) // 防止循环同步
  const initialized = useRef(false)

  const { guests, tables, notes, rooms, stayDates } = useWeddingStore()

  // 初始加载 + 实时订阅
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !supabase) return

    let mounted = true

    async function loadAndSubscribe() {
      // 拉取远端数据
      const [guestsRes, tablesRes, notesRes, roomsRes, configRes] = await Promise.all([
        supabase!.from('guests').select('*').eq('project_id', projectId),
        supabase!.from('tables').select('*').eq('project_id', projectId),
        supabase!.from('notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
        supabase!.from('rooms').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
        supabase!.from('project_config').select('*').eq('project_id', projectId).maybeSingle(),
      ])

      if (!mounted) return
      syncing.current = true

      // 合并远端数据（以远端为准，但保留本次加载窗口内本地已改动、可能尚未同步的宾客）
      if (guestsRes.data) {
        const remote: Guest[] = guestsRes.data.map((r: any) => ({
          id: r.id,
          name: r.name,
          group: r.group_name,
          phone: r.phone || undefined,
          notes: r.notes || undefined,
          tableId: r.table_id,
          seatIndex: r.seat_index,
          roomId: r.room_id ?? null,
          stayDates: r.stay_dates || [],
          status: r.status || 'unassigned',
        }))
        const baseline = prevGuests.current // 挂载时本地快照
        const currentLocal = useWeddingStore.getState().guests
        const remoteIds = new Set(remote.map((r) => r.id))
        const merged = remote.map((rg) => {
          const cur = currentLocal.find((c) => c.id === rg.id)
          const base = baseline.find((b) => b.id === rg.id)
          // 本地在加载窗口内改动过（与快照不同）则保留本地，避免覆盖未推送的编辑
          if (cur && (!base || JSON.stringify(cur) !== JSON.stringify(base))) return cur
          return rg
        })
        // 加载窗口内本地新增、远端还没有的宾客
        const localOnly = currentLocal.filter((c) => !remoteIds.has(c.id) && !baseline.some((b) => b.id === c.id))
        useWeddingStore.setState({ guests: [...merged, ...localOnly] })
      }

      if (configRes.data) {
        useWeddingStore.setState({ stayDates: configRes.data.stay_dates || [] })
      }

      if (roomsRes.data) {
        const remoteRooms: Room[] = roomsRes.data.map((r: any) => ({
          id: r.id,
          type: r.type,
          label: r.label,
          notes: r.notes || undefined,
        }))
        useWeddingStore.setState({ rooms: remoteRooms })
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

      // 关键：加载完成后把 diff 基准重置为刚加载的数据，
      // 避免切换项目时把「上一个项目」的行误判为被删除而从云端删掉（tables/notes 曾因此被清空）。
      {
        const st = useWeddingStore.getState()
        prevGuests.current = st.guests
        prevTables.current = st.tables
        prevNotes.current = st.notes
        prevRooms.current = st.rooms
        prevStayDates.current = st.stayDates
      }

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
                  seatIndex: r.seat_index, roomId: r.room_id ?? null, stayDates: r.stay_dates || [], status: r.status || 'unassigned',
                }]
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({
              guests: store.guests.map(g => g.id === r.id ? {
                ...g, name: r.name, group: r.group_name, phone: r.phone,
                notes: r.notes, tableId: r.table_id, seatIndex: r.seat_index, roomId: r.room_id ?? null, stayDates: r.stay_dates || [], status: r.status || 'unassigned',
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `project_id=eq.${projectId}` }, (payload) => {
          if (syncing.current) return
          const store = useWeddingStore.getState()
          if (payload.eventType === 'INSERT') {
            const r = payload.new as any
            const exists = store.rooms.find(ro => ro.id === r.id)
            if (!exists) {
              useWeddingStore.setState({
                rooms: [...store.rooms, { id: r.id, type: r.type, label: r.label, notes: r.notes || undefined }]
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({
              rooms: store.rooms.map(ro => ro.id === r.id ? {
                ...ro, type: r.type, label: r.label, notes: r.notes || undefined,
              } : ro)
            })
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as any
            useWeddingStore.setState({
              rooms: store.rooms.filter(ro => ro.id !== r.id),
              guests: store.guests.map(g => g.roomId === r.id ? { ...g, roomId: null, stayDates: [] } : g),
            })
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_config', filter: `project_id=eq.${projectId}` }, (payload) => {
          if (syncing.current) return
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const r = payload.new as any
            useWeddingStore.setState({ stayDates: r.stay_dates || [] })
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
  const prevRooms = useRef(rooms)
  const prevStayDates = useRef(stayDates)
  const prevProjectId = useRef(projectId)

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !supabase || !initialized.current || syncing.current) return

    // 切换项目的瞬间：先对齐基准并跳过本次 diff，避免用旧项目基准把新项目差异误判为删除（曾误删 tables/notes）
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId
      prevGuests.current = guests
      prevTables.current = tables
      prevNotes.current = notes
      prevRooms.current = rooms
      prevStayDates.current = stayDates
      return
    }

    const db = supabase

    // 注：guests / rooms 的写库已改为「操作即时写」(store 里 syncUpsertGuest/syncUpsertRoom)，
    // 这里不再做 diff 推送，避免与即时写重复、以及加载竞态导致的丢写。

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

    // 检测 stayDates（项目配置）变更
    const prevSD = prevStayDates.current
    if (stayDates !== prevSD && JSON.stringify(stayDates) !== JSON.stringify(prevSD)) {
      db.from('project_config').upsert(
        { project_id: projectId, stay_dates: stayDates },
        { onConflict: 'project_id' }
      ).then()
    }

    prevGuests.current = guests
    prevTables.current = tables
    prevNotes.current = notes
    prevRooms.current = rooms
    prevStayDates.current = stayDates
  }, [guests, tables, notes, rooms, stayDates, projectId])

  return { isSyncing: isSupabaseConfigured && !!projectId }
}
