import * as XLSX from 'xlsx'
import { ATTENDANCE_LABELS, GUEST_COLUMNS, GUEST_EXPORT_COLUMNS, GUEST_SHEET, MAX_GUEST_ROWS, STAY_NEED_LABELS } from './guestRoster.ts'
import { TRAVEL_LABELS } from '../types/index.ts'
import type { GuestRosterRow } from './guestRoster.ts'

export const MAX_GUEST_WORKBOOK_BYTES = 2 * 1024 * 1024

/** Read the single template sheet locally. No upload of a file, formulas, or formatting. */
export function readGuestRosterWorkbook(bytes: ArrayBuffer): GuestRosterRow[] {
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
  if (bytes.byteLength > MAX_GUEST_WORKBOOK_BYTES || signature.join(',') !== '80,75,3,4') throw Error('请选择不超过 2 MB 的 .xlsx 名单文件。')
  let sheet: XLSX.WorkSheet | undefined
  try {
    sheet = XLSX.read(bytes, { type: 'array', sheets: GUEST_SHEET, sheetRows: MAX_GUEST_ROWS + 2, cellHTML: false }).Sheets[GUEST_SHEET]
  } catch { throw Error('无法读取 Excel，请另存为 .xlsx 后再试。') }
  if (!sheet?.['!ref']) throw Error('找不到「宾客名单」工作表，请用本页导出的表格或模板。')
  const { s, e } = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'])
  if (e.r > MAX_GUEST_ROWS) throw Error(`名单最多 ${MAX_GUEST_ROWS} 行，请清除多余行。`)
  const columns = e.c + 1 === GUEST_EXPORT_COLUMNS.length ? GUEST_EXPORT_COLUMNS : GUEST_COLUMNS
  if (s.r !== 0 || s.c !== 0 || e.c !== columns.length - 1) throw Error('请保留模板的第一行列名和全部列。')
  const cellText = (row: number, col: number, label = '列名') => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined
    if (!cell) return ''
    if (cell.f || cell.F) throw Error(`第 ${row + 1} 行「${label}」包含公式，请粘贴为值。`)
    if (cell.v === undefined || cell.v === '') return ''
    if (typeof cell.v !== 'string' || cell.t === 'e') throw Error(`第 ${row + 1} 行「${label}」请填写文本。`)
    return cell.v
  }
  const headers = Array.from({ length: columns.length }, (_, col) => cellText(0, col).trim())
  if (!columns.every(col => headers.includes(col))) throw Error('列名不符合最新版名单模板，请保留全部表头。')
  const rows: GuestRosterRow[] = []
  for (let r = 1; r <= e.r; r++) {
    const field = (key: typeof GUEST_EXPORT_COLUMNS[number]) => headers.includes(key) ? cellText(r, headers.indexOf(key), key) : ''
    const id = field('宾客编号').trim(), name = field('姓名'), phone = field('电话'), group = field('分组标签'), notes = field('备注')
    const attendanceLabel = field('出席状态').trim(), stayLabel = field('住宿需求').trim()
    const travelLabel = field('出行方式').trim()
    const travelMode = Object.entries(TRAVEL_LABELS).find(([, label]) => label === travelLabel)?.[0] as GuestRosterRow['travelMode']
    if (travelLabel && !travelMode) throw Error(`第 ${r + 1} 行的出行方式不符合模板。`)
    // 桌号与户名供核对，关联以系统记录为准。未提供出行方式时保留已填值。
    if (![id, name, phone, group, notes, attendanceLabel, stayLabel, travelLabel].some(v => v.trim())) continue
    if (!name.trim()) throw Error(`第 ${r + 1} 行「姓名」不能为空。`)
    const attendance = Object.entries(ATTENDANCE_LABELS).find(([, label]) => label === (attendanceLabel || '待确认'))?.[0] as GuestRosterRow['attendance'] | undefined
    const stayNeed = Object.entries(STAY_NEED_LABELS).find(([, label]) => label === (stayLabel || '待确认'))?.[0] as GuestRosterRow['stayNeed'] | undefined
    if (!attendance || !stayNeed) throw Error(`第 ${r + 1} 行的出席状态或住宿需求不符合模板。`)
    rows.push({ id: id || null, name, phone, group, notes, attendance, stayNeed, ...(travelMode ? { travelMode } : {}) })
  }
  return rows
}
