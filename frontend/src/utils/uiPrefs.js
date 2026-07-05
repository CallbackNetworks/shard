import { useSyncExternalStore } from 'react'

// User-adjustable UI preferences, persisted in localStorage for instant,
// synchronous reads at component init and offline availability. Exposed as a
// tiny reactive store so any component (Settings, Sidebar) re-renders when a
// preference changes. Settings also mirrors these to the backend
// `user-preferences` key for cross-device sync.

const STORAGE_KEY = 'ui_prefs'

export const PROJECT_VIEWS = ['issues', 'board', 'timeline', 'calendar', 'table']
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']

// Accent color presets: `main` maps to CSS var --accent (was BRAND #facc15),
// `deep` maps to --accent-2 (was BRAND_2 #eab308).
export const ACCENT_PRESETS = [
  { key: 'amber', main: '#facc15', deep: '#eab308' },
  { key: 'indigo', main: '#818cf8', deep: '#6366f1' },
  { key: 'emerald', main: '#34d399', deep: '#10b981' },
  { key: 'sky', main: '#38bdf8', deep: '#0ea5e9' },
  { key: 'rose', main: '#fb7185', deep: '#f43f5e' },
  { key: 'violet', main: '#a78bfa', deep: '#8b5cf6' },
  { key: 'orange', main: '#fb923c', deep: '#f97316' },
]

// UI scale factors applied via document zoom.
export const UI_SCALES = [
  { value: 0.9, labelKey: 'settings.scaleCompact' },
  { value: 1.0, labelKey: 'settings.scaleDefault' },
  { value: 1.1, labelKey: 'settings.scaleComfortable' },
  { value: 1.2, labelKey: 'settings.scaleLarge' },
]

export const DEFAULT_UI_PREFS = {
  defaultView: 'issues',
  defaultPriority: 'medium',
  reduceMotion: false,
  accent: 'amber',
  uiScale: 1.0,
  sidebarHidden: [], // list of nav `to` paths to hide
  sidebarOrder: [], // list of nav `to` paths giving explicit order
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
    root.style.setProperty('--accent', accent.main)
    root.style.setProperty('--accent-2', accent.deep)
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
