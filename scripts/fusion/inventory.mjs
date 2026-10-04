import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const TABLES = ['guests', 'tables', 'rooms', 'notes', 'project_config']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Read every page using the server's exact count, including servers that cap page sizes. */
export async function readAllPages(readPage) {
  const rows = []
  let expected
  while (true) {
    const result = await readPage(rows.length, 500)
    if (!Number.isSafeInteger(result.count) || result.count < 0 || !Array.isArray(result.rows)) throw Error('INVALID_PAGE')
    if (expected !== undefined && expected !== result.count) throw Error('SOURCE_CHANGED_DURING_READ')
    expected = result.count
    if (!result.rows.length && rows.length < expected) throw Error('INCOMPLETE_PAGE_COVERAGE')
    rows.push(...result.rows)
    if (rows.length > expected) throw Error('PAGE_COUNT_MISMATCH')
    if (rows.length === expected) return rows
  }
}

/** Summaries contain no names, phones, note text, image URLs or project credentials. */
export function inventory(bundle, projectId) {
  if (!projectId || typeof projectId !== 'string') throw Error('PROJECT_REQUIRED')
  const issues = []
  const add = (table, index, code) => issues.push({ table, index, code })
  const counts = {}, bytes = {}, sets = {}
  for (const table of TABLES) {
    if (!Array.isArray(bundle[table])) throw Error(`MISSING_TABLE:${table}`)
    counts[table] = bundle[table].length
    bytes[table] = Buffer.byteLength(JSON.stringify(bundle[table]))
    sets[table] = new Set()
    bundle[table].forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error(`INVALID_ROW:${table}:${index}`)
      if (row.project_id !== projectId) add(table, index, 'PROJECT_MISMATCH')
      const id = table === 'project_config' ? row.project_id : row.id
      if (typeof id !== 'string' || !id) add(table, index, 'MISSING_ID')
      else if (sets[table].has(id)) add(table, index, 'DUPLICATE_ID')
      sets[table].add(id)
    })
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!bundle.project_config.length) add('project_config', null, 'MISSING_PROJECT_CONFIG')
  const dates = new Set(bundle.project_config.flatMap(row => Array.isArray(row.stay_dates) ? row.stay_dates : []))
  bundle.project_config.forEach((row, index) => {
    if (!Array.isArray(row.stay_dates) || row.stay_dates.some(d => !validDate(d))) add('project_config', index, 'INVALID_STAY_DATES')
  })
  const seats = new Set()
  bundle.tables.forEach((row, index) => {
    if (!Number.isInteger(row.seats) || row.seats <= 0) add('tables', index, 'INVALID_CAPACITY')
    if (![row.x, row.y, row.rotation].every(n => n !== null && n !== '' && Number.isFinite(Number(n)))) add('tables', index, 'INVALID_GEOMETRY')
  })
  bundle.guests.forEach((row, index) => {
    if (!['confirmed', 'assigned', 'unassigned'].includes(row.status)) add('guests', index, 'UNKNOWN_ATTENDANCE')
    if (typeof row.name !== 'string' || !row.name.trim()) add('guests', index, 'EMPTY_NAME')
    if ((row.table_id == null) !== (row.seat_index == null)) add('guests', index, 'PARTIAL_SEAT_REFERENCE')
    if (row.table_id != null) {
      const table = bundle.tables.find(t => t.id === row.table_id)
      if (!table) add('guests', index, 'MISSING_TABLE_REFERENCE')
      else if (!Number.isInteger(row.seat_index) || row.seat_index < 0 || row.seat_index >= table.seats) add('guests', index, 'INVALID_SEAT_INDEX')
      const key = JSON.stringify([row.table_id, row.seat_index])
      if (seats.has(key)) add('guests', index, 'DUPLICATE_SEAT')
      seats.add(key)
    }
    if (row.room_id != null && !sets.rooms.has(row.room_id)) add('guests', index, 'MISSING_ROOM_REFERENCE')
    if (!Array.isArray(row.stay_dates) || row.stay_dates.some(d => !validDate(d))) add('guests', index, 'INVALID_STAY_DATES')
    else if (row.stay_dates.some(d => !dates.has(d))) add('guests', index, 'STAY_DATE_NOT_IN_CONFIG')
    if (row.room_id == null && Array.isArray(row.stay_dates) && row.stay_dates.length) add('guests', index, 'DATES_WITHOUT_ROOM')
    if (Array.isArray(row.stay_dates) && new Set(row.stay_dates).size !== row.stay_dates.length) add('guests', index, 'DUPLICATE_STAY_DATE')
  })
  let images = 0, embeddedImageBytes = 0, externalImages = 0
  bundle.notes.forEach((row, index) => {
    if (!Array.isArray(row.images)) { add('notes', index, 'INVALID_IMAGES'); return }
    for (const image of row.images) {
      if (typeof image !== 'string') { add('notes', index, 'INVALID_IMAGE'); continue }
      images++
      if (image.startsWith('data:')) embeddedImageBytes += Buffer.byteLength(image)
      else externalImages++
    }
  })
  return { sourceSystem: 'planner-supabase', sourceProjectHash: createHash('sha256').update(projectId).digest('hex'), sourceHash: hash(bundle), counts, serializedBytes: bytes,
    images: { count: images, embeddedStringBytes: embeddedImageBytes, externalCount: externalImages, externalAvailability: 'NOT_CHECKED' },
    issues, consistency: 'READ_ONLY_INVENTORY_NOT_FROZEN_EXPORT', localBrowserState: 'NOT_COLLECTED' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, projectId, output] = process.argv.slice(2)
  if (!input || !projectId || !output) throw Error('Usage: node scripts/fusion/inventory.mjs <private-bundle.json> <project-id> <summary.json>')
  const bundle = JSON.parse(await readFile(input, 'utf8'))
  await writeFile(output, JSON.stringify(inventory(bundle, projectId), null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log('Read-only inventory summary written. Source was not modified.')
}
