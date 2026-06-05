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

/**
 * Format a date string as short date ("Jun 5").
 */
export function formatDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/**
 * Format a date string as relative time ("2h ago", "in 3d").
 * Returns null if dateStr is falsy.
 */
export function relativeTime(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  const diff = d - now
  const absDiff = Math.abs(diff)
  const mins = Math.floor(absDiff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return diff > 0 ? `in ${days}d` : `${days}d ago`
  if (hours > 0) return diff > 0 ? `in ${hours}h` : `${hours}h ago`
  if (mins > 0) return diff > 0 ? `in ${mins}m` : `${mins}m ago`
  return 'just now'
}
