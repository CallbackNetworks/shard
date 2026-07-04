export { formatMinutes } from '../../utils/formatTime'

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
