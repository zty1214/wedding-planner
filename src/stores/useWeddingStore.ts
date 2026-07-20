import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import type { Guest, Table, Note } from '../types'
import { DEFAULT_GUEST_GROUPS } from '../types'

interface WeddingState {
  projectId: string
  projectTitle: string
  guests: Guest[]
  tables: Table[]
  notes: Note[]
  customGroups: string[]

  // Project actions
  setProjectTitle: (title: string) => void

  // Guest actions
  addGuest: (name: string, group: string, phone?: string) => void
  updateGuest: (id: string, patch: Partial<Guest>) => void
  removeGuest: (id: string) => void
  assignGuestToTable: (guestId: string, tableId: string | null, seatIndex: number | null) => void
  addCustomGroup: (group: string) => void

  // Table actions
  addTable: (seats: number, x: number, y: number) => void
  updateTable: (id: string, patch: Partial<Table>) => void
  removeTable: (id: string) => void

  // Note actions
  addNote: (category: string, title: string, content: string, images: string[]) => void
  updateNote: (id: string, patch: Partial<Note>) => void
  removeNote: (id: string) => void
}

export const useWeddingStore = create<WeddingState>()(
  persist(
    (set) => ({
      projectId: uuid().slice(0, 8),
      projectTitle: '备婚助手',
      guests: [],
      tables: [],
      notes: [],
      customGroups: [],

      setProjectTitle: (title) => set({ projectTitle: title }),

      addGuest: (name, group, phone) =>
        set((s) => ({
          guests: [
            ...s.guests,
            { id: uuid(), name, group, phone, notes: '', tableId: null, seatIndex: null, status: 'unassigned' },
          ],
        })),

      updateGuest: (id, patch) =>
        set((s) => ({
          guests: s.guests.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),

      removeGuest: (id) =>
        set((s) => ({ guests: s.guests.filter((g) => g.id !== id) })),

      assignGuestToTable: (guestId, tableId, seatIndex) =>
        set((s) => ({
          guests: s.guests.map((g) =>
            g.id === guestId
              ? { ...g, tableId, seatIndex, status: tableId ? (g.status === 'confirmed' ? 'confirmed' : 'assigned') : 'unassigned' }
              : g
          ),
        })),

      addCustomGroup: (group) =>
        set((s) => ({
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

      removeTable: (id) =>
        set((s) => ({
          tables: s.tables.filter((t) => t.id !== id),
          guests: s.guests.map((g) =>
            g.tableId === id ? { ...g, tableId: null, seatIndex: null, status: 'unassigned' } : g
          ),
        })),

      addNote: (category, title, content, images) =>
        set((s) => ({
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
        set((s) => ({
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
