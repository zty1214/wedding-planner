/** Preserve the full name, including numeric suffixes used to distinguish guests. */
export function seatNameLayout(name: string) {
  const characters = Array.from(name)
  const columns = Math.max(1, Math.ceil(Math.sqrt(characters.length)))
  const lines: string[] = []
  for (let i = 0; i < characters.length; i += columns) lines.push(characters.slice(i, i + columns).join(''))
  return { text: lines.join('\n'), fontSize: Math.min(11, 28 / columns, 28 / (Math.max(1, lines.length) * 1.1)) }
}
