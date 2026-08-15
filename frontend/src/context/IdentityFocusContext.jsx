import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFocusTargets, getPreference, setPreference } from '../api/client'

const IdentityFocusContext = createContext(null)

const PREF_KEY = 'identity-focus'

// Focus mode: pick one node — an identity, or any other non-project
// container-role node (e.g. a custom "organization" type, ADR-0081) — and the
// app narrows to the projects it reaches via contains/owns. The selection is
// persisted as a user preference so it survives reloads and other devices.
export function IdentityFocusProvider({ children }) {
  const [focusId, setFocusIdState] = useState(null)

  const { data: focusTargets = [] } = useQuery({
    queryKey: ['focus-targets'],
    queryFn: getFocusTargets,
    staleTime: 60000,
  })

  const { data: savedFocus } = useQuery({
    queryKey: ['preference', PREF_KEY],
    queryFn: () => getPreference(PREF_KEY),
    staleTime: 60000,
    retry: false,
  })

  useEffect(() => {
    if (savedFocus?.value?.identityId !== undefined) {
      setFocusIdState(savedFocus.value.identityId)
    }
  }, [savedFocus])

  const setFocusId = useCallback((id) => {
    setFocusIdState(id)
    setPreference(PREF_KEY, { identityId: id }).catch(() => {})
  }, [])

  const toggleFocus = useCallback((id) => {
    setFocusId(focusId === id ? null : id)
  }, [focusId, setFocusId])

  const clearFocus = useCallback(() => setFocusId(null), [setFocusId])

  const focusTarget = useMemo(
    () => focusTargets.find(target => target.id === focusId) || null,
    [focusTargets, focusId]
  )

  // Narrow a project list to the focused target's reachable projects. Projects
  // outside that set stay visible only when no focus is active.
  const filterProjects = useCallback((projects) => {
    if (!focusTarget) return projects
    const ids = new Set(focusTarget.project_ids)
    return projects.filter(project => ids.has(project.id))
  }, [focusTarget])

  const value = useMemo(() => ({
    focusTargets,
    focusId: focusTarget ? focusId : null,
    focusTarget,
    setFocusId,
    toggleFocus,
    clearFocus,
    filterProjects,
  }), [focusTargets, focusId, focusTarget, setFocusId, toggleFocus, clearFocus, filterProjects])

  return (
    <IdentityFocusContext.Provider value={value}>
      {children}
    </IdentityFocusContext.Provider>
  )
}

export function useIdentityFocus() {
  const ctx = useContext(IdentityFocusContext)
  if (!ctx) {
    // Allow components to render outside the provider (tests, share views).
    return {
      focusTargets: [],
      focusId: null,
      focusTarget: null,
      setFocusId: () => {},
      toggleFocus: () => {},
      clearFocus: () => {},
      filterProjects: (projects) => projects,
    }
  }
  return ctx
}
