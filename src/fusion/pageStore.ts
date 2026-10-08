import { roomViews } from './roomNights.ts'
import { createStore } from 'zustand/vanilla'
import type { WeddingState } from '../types/weddingState.ts'
import type { projectRepository } from './repository.ts'
import type { Core } from './core.ts'
import type { Json } from './protocol.ts'

/** Adapts the existing page vocabulary once, with no legacy database calls. */
export function createPageStore(projectId: string, repo: ReturnType<typeof projectRepository>, notice: (message: string) => void) {
  const current = (): Core => {
    const snapshot = repo.getSnapshot().snapshot
    if (!snapshot) throw Error('PROJECT_NOT_READY')
    return snapshot.data
  }
  const unsupported = () => notice('此操作正在接入恢复机制，暂不可用。')
  const send = (type: string, payload: Json, refs: string[] = []) => {
    const c = current(), revisions: Record<string, number> = {}
    for (const ref of refs) {
      const [kind, id] = ref.split(':')
      revisions[ref] = kind === 'guest' ? c.guests[id]?.revision : kind === 'table' ? c.tables[id]?.revision : kind === 'room' ? c.rooms[id]?.revision : kind === 'note' ? repo.getSnapshot().snapshot?.notes?.find(n => n.id === id)?.revision ?? -1 : c.config.revision
    }
    return repo.dispatch(type, payload, revisions)
  }
  const store = createStore<WeddingState>()(() => ({
    projectId, projectTitle: '', mainStagePos: null, guests: [], tables: [], rooms: [], notes: [], customGroups: [], stayDates: [], sharedLinks: [],
    setProjectTitle: title => send('project.update', { patch: { title } }, ['config']),
    setMainStagePos: mainStagePos => send('project.update', { patch: { mainStagePos } }, ['config']),
    addSharedLink: unsupported, renameSharedLink: unsupported, removeSharedLink: unsupported,
    addGuest: (name, group, phone) => send('guest.add', { id: crypto.randomUUID(), name, group, phone: phone ?? '' }),
    updateGuest: (id, patch) => {
      const converted: Record<string, Json> = {}
      for (const key of ['name', 'group', 'phone', 'notes', 'side', 'attendance'] as const) if (Object.hasOwn(patch, key)) converted[key] = patch[key] ?? ''
      if (patch.status && !patch.attendance) converted.attendance = patch.status === 'confirmed' ? 'confirmed' : 'pending'
      return send('guest.update', { id, patch: converted }, [`guest:${id}`])
    },
    removeGuest: id => send('guest.delete', { id }, [`guest:${id}`]),
    swapGuestSeats: (firstId, secondId) => {
      const c = current(), first = c.guests[firstId], second = c.guests[secondId]
      if (!first?.tableId || !second?.tableId) return
      send('guest.swapSeats', { firstId, secondId }, [`guest:${firstId}`, `guest:${secondId}`, `table:${first.tableId}`, `table:${second.tableId}`])
    },
    assignGuestToTable: (id, tableId, seatIndex) => tableId === null
      ? send('guest.unassign', { id }, [`guest:${id}`])
      : send('guest.assign', { id, tableId, seatIndex }, [`guest:${id}`, `table:${tableId}`]),
    assignGuestToRoom: (id, roomId) => roomId === null ? send('guest.clearRoom', { id }, [`guest:${id}`]) : send('guest.assignRoom', { id, roomId }, [`guest:${id}`, ...(roomId ? [`room:${roomId}`] : [])]),
    setGuestStayNeed: (id, stayNeed) => current().guests[id]?.roomId && stayNeed === 'not_needed'
      ? send('guest.clearStayNeed', { id }, [`guest:${id}`])
      : send('guest.setStayNeed', { id, stayNeed }, [`guest:${id}`]),
    setGuestStayDates: (id, dates) => send('guest.setStayDates', { id, dates }, [`guest:${id}`, 'config']),
    addCustomGroup: group => send('group.add', { group }, ['config']),
    addTable: (seats, x, y) => {
      const used = new Set(Object.values(current().tables).map(table => table.label))
      let number = 1
      while (used.has(`第${number}桌`)) number++
      return send('table.add', { id: crypto.randomUUID(), label: `第${number}桌`, seats, x, y })
    },
    updateTable: (id, patch) => send('table.update', { id, patch: JSON.parse(JSON.stringify(patch)) }, [`table:${id}`]),
    removeTable: id => send('table.deleteWithGuests', { id }, [`table:${id}`, ...Object.values(current().guests).filter(g => g.tableId === id).map(g => `guest:${g.id}`)]),
    addRoom: async type => {
      const id = crypto.randomUUID(), used = new Set(Object.values(current().rooms).map(room => room.label.trim()))
      let number = 1
      while (used.has(String(number).padStart(2, '0'))) number++
      return await send('room.add', { id, label: String(number).padStart(2, '0'), type }) ? id : null
    },
    arrangeRoom: (roomId, guestIds, dates) => {
      const affected = [...new Set([...Object.values(current().guests).filter(g => g.roomId === roomId).map(g => g.id), ...guestIds])]
      return send('room.arrange', { id: roomId, guestIds, dates }, [`room:${roomId}`, 'config', ...affected.map(id => `guest:${id}`)])
    },
    updateRoom: (id, patch) => send('room.update', { id, patch: JSON.parse(JSON.stringify(patch)) }, [`room:${id}`]),
    removeRoom: id => send('room.deleteWithAssignments', { id }, [`room:${id}`, ...Object.values(current().guests).filter(g => g.roomId === id).map(g => `guest:${g.id}`)]),
    addStayDate: date => send('stayDate.add', { date }, ['config']),
    removeStayDate: date => send('stayDate.remove', { date }, ['config', ...Object.values(current().guests).filter(g => g.stayDates.includes(date)).map(g => `guest:${g.id}`), ...Object.values(current().rooms).filter(room => room.stayDates?.includes(date)).map(room => `room:${room.id}`)]), setStayDates: unsupported,
    addNote: (category, title, content, images) => {
      if (images.length) { notice('当前只保存文本笔记，图片附件已延后。'); return Promise.resolve(false) }
      return send('note.add', { id: crypto.randomUUID(), category, title, content })
    },
    updateNote: (id, patch) => {
      const old = repo.getSnapshot().snapshot?.notes?.find(n => n.id === id)
      if (!old || patch.images?.length) { notice('笔记不存在或包含尚未支持的图片。'); return Promise.resolve(false) }
      return send('note.update', { id, category: patch.category ?? old.category, title: patch.title ?? old.title, content: patch.content ?? old.content }, [`note:${id}`])
    }, removeNote: id => send('note.delete', { id }, [`note:${id}`]),
  }))
  const apply = () => {
    const snapshot = repo.getSnapshot().snapshot
    if (!snapshot) {
      store.setState({ projectTitle: '', mainStagePos: null, customGroups: [], stayDates: [], guests: [], notes: [], tables: [], rooms: [] })
      return
    }
    const c = snapshot.data, normalizedRooms = roomViews(c)
    const nights = new Map(normalizedRooms.map(room => [room.id, room.stayDates]))
    store.setState({ projectTitle: c.config.title, mainStagePos: c.config.mainStagePos, customGroups: c.config.customGroups, stayDates: c.config.stayDates,
      guests: c.guestOrder.map(id => { const g = c.guests[id]; return { ...g, stayDates: g.roomId ? nights.get(g.roomId) ?? [] : [], status: g.attendance === 'confirmed' ? 'confirmed' : g.tableId ? 'assigned' : 'unassigned' } }),
      notes: (snapshot.notes ?? []).map(note => ({ ...note, images: [] })),
      tables: c.tableOrder.map(id => c.tables[id]), rooms: normalizedRooms })
  }
  apply()
  return { store, unsubscribe: repo.subscribe(apply) }
}
