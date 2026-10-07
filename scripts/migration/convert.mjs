// Source-specific offline candidates only. Never imports or merges live projects.
import { createHash } from 'node:crypto'
import { emptyCore } from '../../src/fusion/core.ts'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { inventory, TABLES } from '../fusion/inventory.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
export function stableMigrationId(system, project, type, id) {
  if ([system, project, type, id].some(v => typeof v !== 'string' || !v)) throw Error('INVALID_SOURCE_REFERENCE')
  return 'm_' + hash(JSON.stringify([system, project, type, id]))
}
const text = value => value ?? ''
const numeric = value => typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value
function begin(rawJson, system, options) {
  if (!options || typeof options.sourceProjectId !== 'string' || !options.sourceProjectId
    || typeof options.batchId !== 'string' || !options.batchId) throw Error('EXPLICIT_SOURCE_AND_BATCH_REQUIRED')
  const source = JSON.parse(rawJson), data = emptyCore(), notes = [], mapping = [], issues = [], defaults = []
  const addIssue = (entityType, index, code, severity = 'blocking') => issues.push({ entityType, index, code, severity })
  const ids = new Map()
  function register(type, id, index) {
    const key = JSON.stringify([type, id]), valid = typeof id === 'string' && id.length > 0 && !ids.has(key)
    const targetId = valid ? stableMigrationId(system, options.sourceProjectId, type, id) : null
    mapping.push({ sourceSystem: system, sourceProjectId: options.sourceProjectId, entityType: type, sourceId: id ?? null, sourceIndex: index, targetId, batchId: options.batchId, disposition: valid ? 'retained' : 'unresolved', decisionId: null })
    if (!valid) addIssue(type, index, 'DUPLICATE_OR_MISSING_SOURCE_ID')
    else ids.set(key, targetId)
    return targetId
  }
  function reference(type, id, index) {
    if (id === null || id === undefined) return null
    const target = ids.get(JSON.stringify([type, id]))
    if (!target) addIssue('guests', index, 'DANGLING_' + type.toUpperCase() + '_REFERENCE')
    return target ?? stableMigrationId(system, options.sourceProjectId, type, String(id))
  }
  return { source, system, options, rawJson, data, notes, mapping, issues, defaults, register, reference, addIssue }
}
function finish(ctx) {
  try { assertCore(ctx.data) } catch { ctx.addIssue('project', null, 'TARGET_CORE_INVALID') }
  for (let index = 0; index < ctx.notes.length; index++) {
    try { assertTextNote(ctx.notes[index]) } catch { ctx.addIssue('notes', index, 'TARGET_NOTE_INVALID') }
  }
  const candidate = { data: ctx.data, notes: ctx.notes }
  const counts = { guests: ctx.data.guestOrder.length, tables: ctx.data.tableOrder.length, rooms: ctx.data.roomOrder.length, notes: ctx.notes.length }
  return { format: 'planner-offline-conversion-v1', batchId: ctx.options.batchId, sourceSystem: ctx.system,
    sourceProjectId: ctx.options.sourceProjectId, sourceHash: hash(ctx.rawJson), supplementalConfigHash: hash(JSON.stringify(ctx.options.localConfig ?? ctx.options.layoutDecision ?? null)),
    candidate, targetHash: hash(JSON.stringify(candidate)), mapping: ctx.mapping, issues: ctx.issues, defaults: ctx.defaults,
    // The full raw source preserves unknown fields, original timestamps and attachments.
    provenance: { rawJson: ctx.rawJson, supplementalConfig: structuredClone(ctx.options.localConfig ?? ctx.options.layoutDecision ?? null) },
    summary: { readyForTrial: !ctx.issues.some(i => i.severity === 'blocking'), counts, sourceRecords: ctx.mapping.length,
      mappedRecords: ctx.mapping.filter(m => m.targetId).length, unresolvedRecords: ctx.mapping.filter(m => !m.targetId).length,
      issues: ctx.issues, defaults: ctx.defaults } }
}
export function convertPlannerSource(rawJson, options) {
  const c = begin(rawJson, 'supabase-planner', options), { source, data } = c
  const report = inventory(source, options.sourceProjectId)
  for (const issue of report.issues) c.addIssue(issue.table, issue.index, issue.code)
  for (const type of TABLES) source[type].forEach((row, index) => c.register(type, type === 'project_config' ? row.project_id : row.id, index))
  if (source.project_config.length > 1) c.addIssue('project_config', null, 'MULTIPLE_SOURCE_CONFIGS')
  const local = options.localConfig
  if (local && local.sourceProjectId !== options.sourceProjectId) c.addIssue('project_config', null, 'LOCAL_CONFIG_PROJECT_MISMATCH')
  const config = local?.sourceProjectId === options.sourceProjectId ? local : null
  data.config.title = config?.title ?? data.config.title
  data.config.mainStagePos = config?.mainStagePos ?? null
  data.config.customGroups = [...new Set([...(config?.customGroups ?? []), ...source.guests.map(g => g.group_name).filter(g => typeof g === 'string' && g)])]
  data.config.stayDates = [...new Set(source.project_config[0]?.stay_dates ?? [])].sort()
  if (config?.stayDates && JSON.stringify([...new Set(config.stayDates)].sort()) !== JSON.stringify(data.config.stayDates)) c.addIssue('project_config', null, 'LOCAL_CLOUD_DATE_DIFFERENCE')
  if (!config) c.defaults.push({ entityType: 'project_config', fields: ['title', 'mainStagePos'], reason: 'NO_RECONCILED_BROWSER_CONFIG' })
  for (const [index, row] of source.tables.entries()) {
    const id = c.mapping.find(m => m.entityType === 'tables' && m.sourceIndex === index)?.targetId
    if (!id) continue
    data.tableOrder.push(id); data.tables[id] = { id, revision: 0, label: row.label, seats: row.seats, x: numeric(row.x), y: numeric(row.y), rotation: numeric(row.rotation) }
  }
  for (const [index, row] of source.rooms.entries()) {
    const id = c.mapping.find(m => m.entityType === 'rooms' && m.sourceIndex === index)?.targetId
    if (!id) continue
    data.roomOrder.push(id); data.rooms[id] = { id, revision: 0, label: row.label, type: row.type, notes: text(row.notes) }
  }
  for (const [index, row] of source.guests.entries()) {
    const id = c.mapping.find(m => m.entityType === 'guests' && m.sourceIndex === index)?.targetId
    if (!id) continue
    data.guestOrder.push(id); data.guests[id] = { id, revision: 0, name: row.name, group: text(row.group_name), phone: text(row.phone), notes: text(row.notes), side: 'unset',
      attendance: row.status === 'confirmed' ? 'confirmed' : 'pending', tableId: c.reference('tables', row.table_id, index), seatIndex: row.seat_index ?? null,
      roomId: c.reference('rooms', row.room_id, index), stayNeed: row.room_id == null ? 'pending' : 'needed', stayDates: [...new Set(row.stay_dates ?? [])].sort() }
    c.defaults.push({ entityType: 'guests', index, fields: ['side', 'stayNeed'], reason: 'PLANNER_V1_FIELD_MAPPING' })
  }
  for (const [index, row] of source.notes.entries()) {
    const id = c.mapping.find(m => m.entityType === 'notes' && m.sourceIndex === index)?.targetId
    if (!id) continue
    c.notes.push({ id, revision: 0, category: row.category, title: text(row.title), content: text(row.content), createdAt: row.created_at, updatedAt: row.updated_at })
    if (row.images?.length) c.addIssue('notes', index, 'OLD_ATTACHMENTS_PRESERVED_IN_SOURCE', 'information')
  }
  return finish(c)
}
export function convertSeatingSource(rawJson, options) {
  const c = begin(rawJson, 'cloudbase-wedding', options), { source, data } = c
  if (source.version !== 1 || !source.tables || !source.guests || !source.canvas) throw Error('UNSUPPORTED_SEATING_SCHEMA')
  c.register('wedding', options.sourceProjectId, 0)
  const tables = Object.entries(source.tables), guests = Object.entries(source.guests)
  tables.forEach(([key, row], index) => { c.register('tables', row.id, index); if (key !== row.id) c.addIssue('tables', index, 'SOURCE_DICTIONARY_KEY_MISMATCH') })
  guests.forEach(([key, row], index) => { c.register('guests', row.id, index); if (key !== row.id) c.addIssue('guests', index, 'SOURCE_DICTIONARY_KEY_MISMATCH') })
  data.config.title = source.title
  data.config.customGroups = [...new Set(guests.map(([, g]) => g.relationshipGroup).filter(g => typeof g === 'string' && g))]
  const decision = options.layoutDecision
  if (!decision || decision.sourceProjectId !== options.sourceProjectId || decision.sourceHash !== hash(rawJson)
    || typeof decision.decisionId !== 'string' || !decision.decisionId || typeof decision.confirmedBy !== 'string' || !decision.confirmedBy
    || typeof decision.confirmedAt !== 'string' || !Number.isFinite(Date.parse(decision.confirmedAt))
    || decision.coordinateMode !== 'preserve-seating-world' || !Object.hasOwn(decision, 'mainStagePos')) c.addIssue('wedding', 0, 'LAYOUT_DECISION_REQUIRED')
  else data.config.mainStagePos = decision.mainStagePos
  c.defaults.push({ entityType: 'wedding', fields: ['rooms', 'stayDates'], reason: 'SEATING_HAS_NO_ACCOMMODATION' })
  for (const [index, [, row]] of tables.entries()) {
    const id = c.mapping.find(m => m.entityType === 'tables' && m.sourceIndex === index)?.targetId
    if (!id) continue
    data.tableOrder.push(id); data.tables[id] = { id, revision: 0, label: row.name, seats: row.capacity, x: row.x, y: row.y, rotation: 0 }
  }
  for (const [index, [, row]] of guests.entries()) {
    const id = c.mapping.find(m => m.entityType === 'guests' && m.sourceIndex === index)?.targetId
    if (!id) continue
    data.guestOrder.push(id); data.guests[id] = { id, revision: 0, name: row.name, group: row.relationshipGroup, phone: row.phone, notes: row.note, side: row.side,
      attendance: row.attendance, tableId: c.reference('tables', row.tableId, index), seatIndex: row.seatIndex, roomId: null, stayNeed: 'pending', stayDates: [] }
  }
  return finish(c)
}
