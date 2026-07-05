// Centralized date/time formatting that respects user preferences
// (relative vs. absolute timestamps, 12h vs. 24h clock). Reads the current
// prefs snapshot so it can be used both inside and outside React render.
import { getUiPrefs } from './uiPrefs'

export function relativeTime(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 30) return `${Math.floor(days / 30)}mo ago`
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

// Absolute date-time, e.g. "Jul 5, 14:30" (24h) or "Jul 5, 2:30 PM" (12h).
export function absoluteTime(dateStr, prefs = getUiPrefs()) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: prefs.timeFormat === '12h',
  })
}

// Clock time only, e.g. "14:30" or "2:30 PM".
export function clockTime(dateStr, prefs = getUiPrefs()) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: prefs.timeFormat === '12h',
  })
}

// Preference-aware timestamp: relative or absolute per the user's choice.
export function formatTimestamp(dateStr, prefs = getUiPrefs()) {
  if (!dateStr) return ''
  return prefs.timestampStyle === 'absolute' ? absoluteTime(dateStr, prefs) : relativeTime(dateStr)
}

// 0 = Sunday ... 6 = Saturday. Index of the first column in week grids.
export function weekStartIndex(prefs = getUiPrefs()) {
  return prefs.weekStart === 'monday' ? 1 : 0
}
