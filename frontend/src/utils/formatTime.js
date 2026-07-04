/**
 * Format minutes as human-readable duration ("1h 30m", "45m").
 */
export function formatMinutes(mins) {
  if (mins == null) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
