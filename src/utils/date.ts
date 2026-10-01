// 住宿日期（晚次）相关工具，日期统一以 'YYYY-MM-DD' 字符串存储

// '2027-01-01' -> '1.1'
export function formatNight(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}.${Number(d)}`
}

// '2027-01-01' -> '1月1日'
export function formatNightCN(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}月${Number(d)}日`
}

// 排序（升序）并去重
export function normalizeDates(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b))
}
