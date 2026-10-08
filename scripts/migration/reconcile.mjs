// Independent source-to-target checks. Reports never contain source field values.
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertCore } from '../../server/fusion/coreHandlers.ts'
import { assertTextNote } from '../../src/fusion/notes.ts'
import { inventory, TABLES } from '../fusion/inventory.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
const idFor = (a, type, id) => 'm_' + hash(JSON.stringify([a.sourceSystem, a.sourceProjectId, type, id]))
const dates = value => [...new Set(value ?? [])].sort()
const numeric = value => typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value
const text = value => value ?? ''
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
function nightly(data) {
  return (Array.isArray(data.config?.stayDates) ? data.config.stayDates : []).map(date => {
    const guests = Object.values(data.guests ?? {}).filter(g => Array.isArray(g.stayDates) && g.stayDates.includes(date))
    return { date, guests: guests.length, rooms: new Set(guests.map(g => g.roomId).filter(Boolean)).size }
  })
}
function roomArrangementNights(data) {
  return (Array.isArray(data.config?.stayDates) ? data.config.stayDates : []).map(date => {
    const guests = Object.values(data.guests ?? {}).filter(guest => guest.roomId && (data.rooms?.[guest.roomId]?.stayDates ?? guest.stayDates ?? []).includes(date))
    return { date, arrangedPeople: guests.length, rooms: new Set(guests.map(guest => guest.roomId)).size }
  })
}
/** actual is a full readback {data, notes}, never merely aggregate counts. */
export function reconcileConversion(artifact, actual = artifact.candidate) {
  const issues = [], add = (code, entityType = 'project', index = null, field = null) => issues.push({ code, entityType, index, field })
  if (artifact.format !== 'planner-offline-conversion-v1' || !artifact.sourceProjectId || !artifact.batchId
    || !['supabase-planner', 'cloudbase-wedding'].includes(artifact.sourceSystem)) throw Error('INVALID_CONVERSION_ARTIFACT')
  const raw = artifact.provenance.rawJson, config = artifact.provenance.supplementalConfig
  let source = JSON.parse(raw)
  if (artifact.sourceSystem === 'cloudbase-wedding' && Object.hasOwn(source, 'weddings')) {
    const row = source.weddings?.[0]
    if (!Array.isArray(source.weddings) || source.weddings.length !== 1 || row?._id !== artifact.sourceProjectId
      || row.projectId !== artifact.sourceProjectId || row.schemaVersion !== 1 || !row.wedding
      || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt) || row.updatedAt !== row.wedding.updatedAt) throw Error('SOURCE_PROJECT_OR_VERSION_MISMATCH')
    source = row.wedding
  }
  if (hash(raw) !== artifact.sourceHash) add('SOURCE_HASH_MISMATCH')
  if (hash(JSON.stringify(config)) !== artifact.supplementalConfigHash) add('SUPPLEMENTAL_HASH_MISMATCH')
  if (hash(JSON.stringify(artifact.candidate)) !== artifact.targetHash) add('CANDIDATE_HASH_MISMATCH')
  try { assertCore(actual.data) } catch { add('TARGET_CORE_INVALID') }
  if (!Array.isArray(actual.notes)) throw Error('COMPLETE_NOTE_READBACK_REQUIRED')
  for (const [i, n] of actual.notes.entries()) { try { assertTextNote(n) } catch { add('TARGET_NOTE_INVALID', 'notes', i) } }
  if (artifact.issues.some(i => i.severity === 'blocking')) add('UNRESOLVED_SOURCE_ISSUES')
  const planner = artifact.sourceSystem === 'supabase-planner'
  const supplemented = planner && source.project_config.length === 0 && config?.sourceProjectId === artifact.sourceProjectId
    && config?.sourceHash === hash(raw) && config?.missingCloudConfig === 'guest-date-union'
  const guestDates = planner ? dates(source.guests.flatMap(g => Array.isArray(g.stay_dates) ? g.stay_dates : [])) : []
  if (planner) for (const i of inventory(supplemented ? { ...source, project_config: [{ project_id: artifact.sourceProjectId, stay_dates: guestDates }] } : source, artifact.sourceProjectId).issues) add(i.code, i.table, i.index)
  else if (source.version !== 1) add('UNSUPPORTED_SEATING_SCHEMA')
  const decisions = artifact.provenance.noteDecisions ?? []
  if (!Array.isArray(decisions)) throw Error('INVALID_NOTE_DECISIONS')
  if ((artifact.noteDecisionsHash !== undefined || decisions.length) && hash(JSON.stringify(decisions)) !== artifact.noteDecisionsHash) add('NOTE_DECISIONS_HASH_MISMATCH')
  const validDecisions = new Map(), decisionIds = new Set()
  for (const decision of decisions) {
    const row = planner ? source.notes.find(note => note.id === decision?.noteId) : null
    const valid = row && Array.isArray(row.images) && row.images.length > 0 && !String(text(row.content)).trim()
      && decision.sourceProjectId === artifact.sourceProjectId && decision.sourceHash === hash(raw)
      && typeof decision.decisionId === 'string' && decision.decisionId.trim() && !decisionIds.has(decision.decisionId) && !validDecisions.has(decision.noteId)
      && typeof decision.confirmedBy === 'string' && decision.confirmedBy.trim() && typeof decision.confirmedAt === 'string' && Number.isFinite(Date.parse(decision.confirmedAt))
      && typeof decision.reason === 'string' && decision.reason.trim()
      && (decision.action === 'exclude' || decision.action === 'text' && typeof decision.content === 'string' && decision.content.trim() && (decision.title === undefined || typeof decision.title === 'string'))
    if (!valid) { add('INVALID_NOTE_DECISION', 'notes'); continue }
    validDecisions.set(decision.noteId, decision); decisionIds.add(decision.decisionId)
  }
  const rows = planner ? Object.fromEntries(TABLES.map(t => [t, source[t]]))
    : { tables: Object.values(source.tables), guests: Object.values(source.guests), wedding: [source] }
  const expectedOrders = { guests: [], tables: [], rooms: [], notes: [] }, expectedGuests = {}, expectedRooms = {}, seen = new Set()
  let sourceRecords = 0, mappedRecords = 0, excludedRecords = 0, checkedFields = 0
  function compare(type, index, object, expected) {
    for (const [field, value] of Object.entries(expected)) {
      checkedFields++
      if (!isDeepStrictEqual(object?.[field], value)) add('FIELD_MISMATCH', type, index, field)
    }
  }
  const reference = (type, id) => id == null ? null : idFor(artifact, type, id)
  for (const [type, entries] of Object.entries(rows)) for (const [index, row] of entries.entries()) {
    sourceRecords++
    const sourceId = type === 'project_config' ? row.project_id : type === 'wedding' ? artifact.sourceProjectId : row.id
    const maps = artifact.mapping.filter(m => m.entityType === type && m.sourceIndex === index)
    const unique = typeof sourceId === 'string' && sourceId && !seen.has(JSON.stringify([type, sourceId]))
    seen.add(JSON.stringify([type, sourceId]))
    if (!unique || maps.length !== 1) { add('SOURCE_DISPOSITION_UNRESOLVED', type, index); continue }
    const m = maps[0], id = idFor(artifact, type, sourceId)
    const pureImage = planner && type === 'notes' && Array.isArray(row.images) && row.images.length > 0 && !String(text(row.content)).trim()
    const decision = type === 'notes' ? validDecisions.get(sourceId) : undefined
    if (pureImage && !decision) add('PURE_IMAGE_NOTE_DECISION_REQUIRED', type, index)
    const excluded = decision?.action === 'exclude'
    if (m.sourceSystem !== artifact.sourceSystem || m.sourceProjectId !== artifact.sourceProjectId || m.batchId !== artifact.batchId
      || m.sourceId !== sourceId || m.targetId !== (excluded ? null : id) || m.disposition !== (excluded ? 'excluded' : 'retained')
      || (m.decisionId ?? null) !== (decision?.decisionId ?? null)) { add('INVALID_ID_MAPPING', type, index); continue }
    if (excluded) { excludedRecords++; if (actual.notes.some(note => note.id === id)) add('EXCLUDED_RECORD_PRESENT', type, index); continue }
    mappedRecords++
    if (type === 'project_config' || type === 'wedding') continue
    expectedOrders[type].push(id)
    const target = type === 'notes' ? actual.notes.find(n => n.id === id) : actual.data[type]?.[id]
    if (!target) add('TARGET_RECORD_MISSING', type, index)
    let fields
    if (type === 'tables') fields = { id, revision: 0, label: planner ? row.label : row.name, seats: planner ? row.seats : row.capacity,
      x: planner ? numeric(row.x) : row.x, y: planner ? numeric(row.y) : row.y, rotation: planner ? numeric(row.rotation) : 0 }
    if (type === 'rooms') fields = { id, revision: 0, label: row.label, type: row.type, notes: text(row.notes), stayDates: [...new Set(source.guests.filter(g => g.room_id === row.id).flatMap(g => g.stay_dates ?? []))].sort() }
    if (type === 'notes') fields = { id, revision: 0, category: row.category, title: decision?.action === 'text' ? decision.title ?? text(row.title) : text(row.title), content: decision?.action === 'text' ? decision.content : text(row.content), createdAt: row.created_at, updatedAt: row.updated_at }
    if (type === 'guests') {
      fields = { id, revision: 0, name: row.name, group: planner ? text(row.group_name) : row.relationshipGroup,
        phone: planner ? text(row.phone) : row.phone, notes: planner ? text(row.notes) : row.note,
        side: planner ? 'unset' : row.side, attendance: planner ? row.status === 'confirmed' ? 'confirmed' : 'pending' : row.attendance,
        tableId: reference('tables', planner ? row.table_id : row.tableId), seatIndex: (planner ? row.seat_index : row.seatIndex) ?? null,
        roomId: planner ? reference('rooms', row.room_id) : null, stayNeed: planner && row.room_id != null ? 'needed' : 'pending', stayDates: planner ? dates(row.stay_dates) : [] }
      expectedGuests[id] = fields
    }
    if (type === 'rooms') expectedRooms[id] = fields
    compare(type, index, target, fields)
  }
  if (artifact.mapping.length !== sourceRecords) add('MAPPING_COUNT_MISMATCH')
  for (const type of ['guests', 'tables', 'rooms']) {
    compare(type, null, { order: actual.data[type.slice(0, -1) + 'Order'], ids: Object.keys(actual.data[type] ?? {}).sort() },
      { order: expectedOrders[type], ids: [...expectedOrders[type]].sort() })
  }
  compare('notes', null, { order: actual.notes.map(n => n.id) }, { order: expectedOrders.notes })
  const local = planner && config?.sourceProjectId === artifact.sourceProjectId ? config : null
  let expectedConfig
  if (planner) {
    expectedConfig = { revision: 0, title: local?.title ?? '备婚助手', mainStagePos: local?.mainStagePos ?? null,
      customGroups: [...new Set([...(local?.customGroups ?? []), ...source.guests.map(g => g.group_name).filter(g => typeof g === 'string' && g)])], stayDates: supplemented ? guestDates : dates(source.project_config[0]?.stay_dates) }
    if (config && !local) add('LOCAL_CONFIG_PROJECT_MISMATCH')
    if (local?.stayDates && !isDeepStrictEqual(dates(local.stayDates), expectedConfig.stayDates)) add('LOCAL_CLOUD_DATE_DIFFERENCE')
  } else {
    const valid = config?.sourceProjectId === artifact.sourceProjectId && config?.sourceHash === hash(raw)
      && config.coordinateMode === 'preserve-seating-world' && typeof config.decisionId === 'string' && config.decisionId
      && typeof config.confirmedBy === 'string' && config.confirmedBy && typeof config.confirmedAt === 'string'
      && Number.isFinite(Date.parse(config.confirmedAt)) && Object.hasOwn(config, 'mainStagePos')
    if (!valid) add('LAYOUT_DECISION_REQUIRED')
    for (const type of ['tables', 'guests']) if (Object.entries(source[type]).some(([key, row]) => key !== row.id)) add('SOURCE_DICTIONARY_KEY_MISMATCH', type)
    expectedConfig = { revision: 0, title: source.title, mainStagePos: valid ? config.mainStagePos : null,
      customGroups: [...new Set(rows.guests.map(g => g.relationshipGroup).filter(g => typeof g === 'string' && g))], stayDates: [] }
  }
  compare('config', null, actual.data.config, expectedConfig)
  const expectedNights = nightly({ config: expectedConfig, guests: expectedGuests }), actualNights = nightly(actual.data)
  compare('overnight', null, { nights: actualNights }, { nights: expectedNights })
  const arrangedNights = roomArrangementNights(actual.data)
  compare('room-nightly', null, { nights: arrangedNights }, { nights: roomArrangementNights({ config: expectedConfig, guests: expectedGuests, rooms: expectedRooms }) })
  return { format: 'planner-reconciliation-v1', passed: issues.length === 0, sourceHash: hash(raw),
    targetReadbackHash: hash(JSON.stringify(actual)), sourceRecords, mappedRecords, excludedRecords, retainedCoverage: sourceRecords ? mappedRecords / sourceRecords : 1, dispositionCoverage: sourceRecords ? (mappedRecords + excludedRecords) / sourceRecords : 1,
    checkedFields, counts: Object.fromEntries(Object.entries(expectedOrders).map(([k, ids]) => [k, ids.length])),
    nights: actualNights.filter(n => isoDate(n.date)), roomArrangementNights: arrangedNights.filter(n => isoDate(n.date)), issues }
}
