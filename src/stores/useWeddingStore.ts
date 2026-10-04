import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { Guest, Room } from '../types'
import { DEFAULT_GUEST_GROUPS } from '../types'
import { normalizeDates } from '../utils/date'
import { syncUpsertGuest, syncDeleteGuest, syncUpsertRoom, syncDeleteRoom } from '../lib/db'

import type { WeddingState } from '../types/weddingState'

export const useWeddingStore = create<WeddingState>()(
  persist(
    (set, get) => ({
      projectId: uuid().slice(0, 8),
      projectTitle: '备婚助手',
      mainStagePos: null,
      guests: [],
      tables: [],
      rooms: [],
      notes: [],
      customGroups: [],
      stayDates: [],
      sharedLinks: [],

      setProjectTitle: (title) => { set({ projectTitle: title }) },
      setMainStagePos: (pos) => set({ mainStagePos: pos }),

      addSharedLink: (link) => set((s) => ({ sharedLinks: [link, ...s.sharedLinks] })),
      renameSharedLink: (id, name) =>
        set((s) => ({ sharedLinks: s.sharedLinks.map((l) => (l.id === id ? { ...l, name } : l)) })),
      removeSharedLink: (id) => set((s) => ({ sharedLinks: s.sharedLinks.filter((l) => l.id !== id) })),

      addGuest: (name, group, phone) => {
        const g: Guest = { id: uuid(), name, group, phone, notes: '', tableId: null, seatIndex: null, roomId: null, stayDates: [], status: 'unassigned' }
        set((s) => ({ guests: [...s.guests, g] }))
        syncUpsertGuest(g, get().projectId)
      },

      updateGuest: (id, patch) => {
        set((s) => ({ guests: s.guests.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
        const g = get().guests.find((x) => x.id === id)
        if (g) syncUpsertGuest(g, get().projectId)
      },

      removeGuest: (id) => {
        set((s) => ({ guests: s.guests.filter((g) => g.id !== id) }))
        syncDeleteGuest(id)
      },

      assignGuestToTable: (guestId, tableId, seatIndex) => {
        set((s) => ({
          guests: s.guests.map((g) =>
            g.id === guestId
              ? { ...g, tableId, seatIndex, status: tableId ? (g.status === 'confirmed' ? 'confirmed' : 'assigned') : 'unassigned' }
              : g
          ),
        }))
        const g = get().guests.find((x) => x.id === guestId)
        if (g) syncUpsertGuest(g, get().projectId)
      },

      // 住宿分配与座位/出席状态相互独立。分配到房间不自动选晚次（由用户手动点选），移出时清空。
      assignGuestToRoom: (guestId, roomId) => {
        set((s) => ({
          guests: s.guests.map((g) =>
            g.id === guestId
              ? { ...g, roomId, stayDates: roomId ? normalizeDates(g.stayDates || []) : [] }
              : g
          ),
        }))
        const g = get().guests.find((x) => x.id === guestId)
        if (g) syncUpsertGuest(g, get().projectId)
      },

      setGuestStayDates: (guestId, dates) => {
        set((s) => ({ guests: s.guests.map((g) => (g.id === guestId ? { ...g, stayDates: normalizeDates(dates) } : g)) }))
        const g = get().guests.find((x) => x.id === guestId)
        if (g) syncUpsertGuest(g, get().projectId)
      },

      addCustomGroup: (group) =>
        void set((s) => ({
          customGroups: s.customGroups.includes(group)
            ? s.customGroups
            : [...s.customGroups, group],
        })),

      addTable: (seats, x, y) =>
        set((s) => {
          const num = s.tables.length + 1
          return {
            tables: [
              ...s.tables,
              { id: uuid(), label: `第${num}桌`, x, y, seats, rotation: 0 },
            ],
          }
        }),

      updateTable: (id, patch) =>
        set((s) => ({
          tables: s.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      removeTable: (id) => {
        const affected = get().guests.filter((g) => g.tableId === id).map((g) => g.id)
        set((s) => ({
          tables: s.tables.filter((t) => t.id !== id),
          guests: s.guests.map((g) =>
            g.tableId === id ? { ...g, tableId: null, seatIndex: null, status: 'unassigned' } : g
          ),
        }))
        const pid = get().projectId
        affected.forEach((gid) => {
          const g = get().guests.find((x) => x.id === gid)
          if (g) syncUpsertGuest(g, pid)
        })
      },

      addRoom: (type) => {
        const num = get().rooms.filter((r) => r.type === type).length + 1
        const room: Room = { id: uuid(), type, label: `${type}${num}` }
        set((s) => ({ rooms: [...s.rooms, room] }))
        syncUpsertRoom(room, get().projectId)
      },

      updateRoom: (id, patch) => {
        set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
        const room = get().rooms.find((r) => r.id === id)
        if (room) syncUpsertRoom(room, get().projectId)
      },

      removeRoom: (id) => {
        const affected = get().guests.filter((g) => g.roomId === id).map((g) => g.id)
        set((s) => ({
          rooms: s.rooms.filter((r) => r.id !== id),
          guests: s.guests.map((g) => (g.roomId === id ? { ...g, roomId: null, stayDates: [] } : g)),
        }))
        syncDeleteRoom(id)
        const pid = get().projectId
        affected.forEach((gid) => {
          const g = get().guests.find((x) => x.id === gid)
          if (g) syncUpsertGuest(g, pid)
        })
      },

      addStayDate: (date) =>
        set((s) => ({ stayDates: normalizeDates([...s.stayDates, date]) })),

      removeStayDate: (date) => {
        const affected = get().guests.filter((g) => (g.stayDates || []).includes(date)).map((g) => g.id)
        set((s) => ({
          stayDates: s.stayDates.filter((d) => d !== date),
          guests: s.guests.map((g) =>
            (g.stayDates || []).includes(date) ? { ...g, stayDates: g.stayDates.filter((d) => d !== date) } : g
          ),
        }))
        const pid = get().projectId
        affected.forEach((gid) => {
          const g = get().guests.find((x) => x.id === gid)
          if (g) syncUpsertGuest(g, pid)
        })
      },

      setStayDates: (dates) => set({ stayDates: normalizeDates(dates) }),

      addNote: (category, title, content, images) =>
        void set((s) => ({
          notes: [
            {
              id: uuid(),
              category,
              title,
              content,
              images,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...s.notes,
          ],
        })),

      updateNote: (id, patch) =>
        void set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n
          ),
        })),

      removeNote: (id) =>
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
    }),
    { name: 'wedding-planner-store' }
  )
)

export const useAllGroups = () => {
  const customGroups = useWeddingStore((s) => s.customGroups)
  return [...DEFAULT_GUEST_GROUPS, ...customGroups]
}
