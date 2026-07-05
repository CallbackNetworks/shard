// User-adjustable UI preferences, persisted in localStorage for instant,
// synchronous reads at component init and offline availability. Settings also
// mirrors these to the backend `user-preferences` key for cross-device sync.

const STORAGE_KEY = 'ui_prefs'

export const PROJECT_VIEWS = ['issues', 'board', 'timeline', 'calendar', 'table']
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']

export const DEFAULT_UI_PREFS = {
  defaultView: 'issues',
  defaultPriority: 'medium',
  reduceMotion: false,
}

export function getUiPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULT_UI_PREFS, ...raw }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

export function setUiPref(key, value) {
  const next = { ...getUiPrefs(), [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  applyUiPrefs(next)
  return next
}

// Apply preferences that affect the document (currently reduced motion).
export function applyUiPrefs(prefs = getUiPrefs()) {
  try {
    const root = document.documentElement
    root.setAttribute('data-motion', prefs.reduceMotion ? 'reduced' : 'full')
  } catch {
    /* document unavailable (SSR/tests) */
  }
}
