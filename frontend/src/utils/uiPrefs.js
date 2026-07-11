import { useSyncExternalStore } from 'react'

// User-adjustable UI preferences, persisted in localStorage for instant,
// synchronous reads at component init and offline availability. Exposed as a
// tiny reactive store so any component (Settings, Sidebar) re-renders when a
// preference changes. Settings also mirrors these to the backend
// `user-preferences` key for cross-device sync.

const STORAGE_KEY = 'ui_prefs'

export const PROJECT_VIEWS = ['issues', 'board', 'timeline', 'calendar', 'table']
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']

// Accent color presets: `main`/`deep` are used in dark mode, `mainLight`/
// `deepLight` in light mode (darker shades that stay readable on white).
// applyUiPrefs publishes all four as CSS vars; global.css resolves --accent
// and --accent-2 per theme.
export const ACCENT_PRESETS = [
  { key: 'amber', main: '#facc15', deep: '#eab308', mainLight: '#a16207', deepLight: '#854d0e' },
  { key: 'indigo', main: '#818cf8', deep: '#6366f1', mainLight: '#4f46e5', deepLight: '#4338ca' },
  { key: 'emerald', main: '#34d399', deep: '#10b981', mainLight: '#059669', deepLight: '#047857' },
  { key: 'sky', main: '#38bdf8', deep: '#0ea5e9', mainLight: '#0284c7', deepLight: '#0369a1' },
  { key: 'rose', main: '#fb7185', deep: '#f43f5e', mainLight: '#e11d48', deepLight: '#be123c' },
  { key: 'violet', main: '#a78bfa', deep: '#8b5cf6', mainLight: '#7c3aed', deepLight: '#6d28d9' },
  { key: 'orange', main: '#fb923c', deep: '#f97316', mainLight: '#ea580c', deepLight: '#c2410c' },
]

// UI scale factors applied via document zoom.
export const UI_SCALES = [
  { value: 0.9, labelKey: 'settings.scaleCompact' },
  { value: 1.0, labelKey: 'settings.scaleDefault' },
  { value: 1.1, labelKey: 'settings.scaleComfortable' },
  { value: 1.2, labelKey: 'settings.scaleLarge' },
]

// Date/time display options.
export const TIME_FORMATS = ['24h', '12h']
export const WEEK_STARTS = ['sunday', 'monday']
export const TIMESTAMP_STYLES = ['relative', 'absolute']

// List density controls how many items compact lists show. `full` means show
// all. `standard` keeps the original hardcoded counts.
export const LIST_DENSITIES = ['compact', 'standard', 'full']
const DENSITY_FACTOR = { compact: 0.6, standard: 1, full: Infinity }

// Live-refresh cadence presets mapped against each query's baseline interval.
export const REFRESH_RATES = ['live', 'standard', 'battery']

export const DEFAULT_UI_PREFS = {
  defaultView: 'issues',
  defaultPriority: 'medium',
  reduceMotion: false,
  accent: 'amber',
  uiScale: 1.0,
  sidebarHidden: [], // list of nav `to` paths to hide
  sidebarOrder: [], // list of nav `to` paths giving explicit order
  timeFormat: '24h',
  weekStart: 'sunday',
  timestampStyle: 'relative',
  listDensity: 'standard',
  refreshRate: 'standard',
}

// Adjust a list's standard item count by the active density. Returns Infinity
// for `full` so callers can `.slice(0, count)` uniformly.
export function densityCount(standard, prefs = current) {
  const factor = DENSITY_FACTOR[prefs.listDensity] ?? 1
  if (factor === Infinity) return Infinity
  return Math.max(1, Math.ceil(standard * factor))
}

// Resolve a query's effective refetch interval (ms) from its baseline.
// Returns false to disable auto-refetch (battery saver).
export function refreshInterval(baselineMs, prefs = current) {
  if (prefs.refreshRate === 'battery') return false
  if (prefs.refreshRate === 'live') return Math.min(baselineMs, 15000)
  return baselineMs
}

function readStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULT_UI_PREFS, ...raw }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

let current = readStorage()
const listeners = new Set()

export function getUiPrefs() {
  return current
}

export function setUiPref(key, value) {
  current = { ...current, [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable */
  }
  applyUiPrefs(current)
  listeners.forEach(l => l())
  return current
}

export function resolveAccent(prefs = current) {
  return ACCENT_PRESETS.find(a => a.key === prefs.accent) || ACCENT_PRESETS[0]
}

// Apply preferences that affect the document: reduced motion, accent color,
// and UI scale.
export function applyUiPrefs(prefs = current) {
  try {
    const root = document.documentElement
    root.setAttribute('data-motion', prefs.reduceMotion ? 'reduced' : 'full')
    const accent = resolveAccent(prefs)
    root.style.setProperty('--accent-dark', accent.main)
    root.style.setProperty('--accent-2-dark', accent.deep)
    root.style.setProperty('--accent-light', accent.mainLight || accent.main)
    root.style.setProperty('--accent-2-light', accent.deepLight || accent.deep)
    // Clear legacy direct vars so the theme-resolved values in global.css
    // win; setting --accent inline would defeat the light-mode override.
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-2')
    root.style.zoom = prefs.uiScale && prefs.uiScale !== 1 ? String(prefs.uiScale) : ''
  } catch {
    /* document unavailable (SSR/tests) */
  }
}

// Reactive hook: returns the current prefs and re-renders on change.
function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useUiPrefs() {
  return useSyncExternalStore(subscribe, getUiPrefs, getUiPrefs)
}
