import { supabase, isSupabaseConfigured } from './supabase'
import type { Guest, Room } from '../types'

// 即时写库（write-through）：在用户每次操作时直接 upsert/delete 到 Supabase，
// 不再依赖“定时 diff 推送”，避免加载竞态导致的改动丢失。
// 未配置 Supabase 时静默跳过（纯本地模式）。

export function syncUpsertGuest(g: Guest, projectId: string) {
  if (!isSupabaseConfigured || !supabase || !projectId) return
  supabase
    .from('guests')
    .upsert({
      id: g.id, project_id: projectId, name: g.name, group_name: g.group,
      phone: g.phone || null, notes: g.notes || null,
      table_id: g.tableId, seat_index: g.seatIndex, room_id: g.roomId ?? null,
      stay_dates: g.stayDates || [], status: g.status,
    })
    .then((r) => { if (r.error) console.error('[guest upsert]', r.error) })
}

export function syncDeleteGuest(id: string) {
  if (!isSupabaseConfigured || !supabase) return
  supabase.from('guests').delete().eq('id', id).then((r) => { if (r.error) console.error('[guest delete]', r.error) })
}

export function syncUpsertRoom(room: Room, projectId: string) {
  if (!isSupabaseConfigured || !supabase || !projectId) return
  supabase
    .from('rooms')
    .upsert({ id: room.id, project_id: projectId, type: room.type, label: room.label, notes: room.notes || null })
    .then((r) => { if (r.error) console.error('[room upsert]', r.error) })
}

export function syncDeleteRoom(id: string) {
  if (!isSupabaseConfigured || !supabase) return
  supabase.from('rooms').delete().eq('id', id).then((r) => { if (r.error) console.error('[room delete]', r.error) })
}
