import { useSyncExternalStore } from 'react'

// Most-recently-visited project ids, persisted locally (ADR-0067).
//
// Only ids are stored: names, status and counts are already in the ['projects']
// query, and a cached copy of them would go stale the moment a project is
// renamed. This list answers "which project were you just in", nothing else.

const STORAGE_KEY = 'recent_projects'
const MAX = 8

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

let current = read()
const listeners = new Set()

export function getRecentProjectIds() {
  return current
}

// Move a project to the front. Idempotent, so calling it on every render of a
// project page costs nothing and cannot grow the list.
export function touchProject(id) {
  if (!id) return current
  if (current[0] === id) return current
  current = [id, ...current.filter(x => x !== id)].slice(0, MAX)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable */
  }
  listeners.forEach(l => l())
  return current
}

export function forgetProject(id) {
  const next = current.filter(x => x !== id)
  if (next.length === current.length) return current
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage unavailable */
  }
  listeners.forEach(l => l())
  return current
}

// Order a project list most-recent-first, keeping unvisited projects behind in
// their original order. Projects in the recent list that no longer exist (or
// are filtered out) simply drop away.
export function orderByRecent(projects, recentIds = current) {
  const rank = new Map(recentIds.map((id, i) => [id, i]))
  const seen = []
  const rest = []
  projects.forEach(p => (rank.has(p.id) ? seen : rest).push(p))
  seen.sort((a, b) => rank.get(a.id) - rank.get(b.id))
  return { recent: seen, rest }
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useRecentProjectIds() {
  return useSyncExternalStore(subscribe, getRecentProjectIds, getRecentProjectIds)
}
