// Local MemoryStore sample only; never connects to a cloud or reads real records.
import { randomBytes, randomUUID } from 'node:crypto'
import { emptyCore } from '../../src/fusion/core.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
import { hashSecret } from '../../server/fusion/commandService.ts'
import { noteService } from '../../server/fusion/noteService.ts'
export async function seedVisualScale(store) {
  const data = emptyCore(), projectId = `fusion-created-${randomUUID()}`, epoch = 'visual-scale-epoch'
  const secret = randomBytes(32).toString('hex')
  data.config.title = '虚构 150 人 · 长文本视觉验收'
  data.config.stayDates = ['2026-12-31', '2027-01-01']
  for (let i = 0; i < 15; i++) {
    const id = `t${i}`; data.tableOrder.push(id)
    data.tables[id] = { id, revision: 0, label: `亲友第${i + 1}桌`, seats: 10, x: 150 + i % 5 * 250, y: 200 + Math.floor(i / 5) * 250, rotation: 0 }
  }
  for (let i = 0; i < 30; i++) {
    const id = `r${i}`; data.roomOrder.push(id)
    data.rooms[id] = { id, revision: 0, label: `0${String(i + 1).padStart(2, '0')}`, type: '标间', notes: '虚构房间' }
  }
  for (let i = 0; i < 150; i++) {
    const id = `g${i}`; data.guestOrder.push(id)
    data.guests[id] = { id, revision: 0, name: i % 10 === 0 ? `虚构长姓名欧阳司徒一家亲友代表${i + 1}` : `虚构宾客${i + 1}`, group: i % 2 ? '新郎亲属' : '新娘朋友', phone: `00${String(i).padStart(9, '0')}`, notes: '纯虚构验收数据', side: i % 2 ? 'groom' : 'bride', attendance: 'confirmed', tableId: `t${Math.floor(i / 10)}`, seatIndex: i % 10, roomId: i < 60 ? `r${Math.floor(i / 2)}` : null, stayNeed: i < 60 ? 'needed' : 'not_needed', stayDates: i < 60 ? (i % 2 ? ['2027-01-01'] : [...data.config.stayDates]) : [] }
  }
  assertCore(data)
  store.seed(projectId, { collaborationHash: hashSecret(randomBytes(32).toString('hex')), managementHash: hashSecret(secret) }, { dataEpoch: epoch, snapshotRevision: 0, data })
  await noteService(store).execute({ projectId, dataEpoch: epoch, commandVersion: 1, operationId: randomUUID(), type: 'note.add', expectedRevisions: {}, payload: { id: 'long-note', category: '酒店', title: '虚构长笔记 · 完整正文', content: '虚构备婚记录：确认场地、交通、宾客到达与房间安排。\n'.repeat(80) } }, secret)
  return `/fusion/p/${projectId}/seating#key=${secret}`
}
