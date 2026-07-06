import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getIdentities, getPreference, setPreference } from '../api/client'

const IdentityFocusContext = createContext(null)

const PREF_KEY = 'identity-focus'

// Focus mode: pick one identity and the app narrows to that identity's
// projects. The selection is persisted as a user preference so it survives
// reloads and other devices.
export function IdentityFocusProvider({ children }) {
  const [focusId, setFocusIdState] = useState(null)

  const { data: identities = [] } = useQuery({
    queryKey: ['identities'],
    queryFn: getIdentities,
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

  const focusIdentity = useMemo(
    () => identities.find(identity => identity.id === focusId) || null,
    [identities, focusId]
  )

  // Narrow a project list to the focused identity. Projects without any
  // identity stay visible only when no focus is active.
  const filterProjects = useCallback((projects) => {
    if (!focusId) return projects
    return projects.filter(project =>
      (project.identities || []).some(identity => identity.id === focusId)
    )
  }, [focusId])

  const value = useMemo(() => ({
    identities,
    focusId: focusIdentity ? focusId : null,
    focusIdentity,
    setFocusId,
    toggleFocus,
    clearFocus,
    filterProjects,
  }), [identities, focusId, focusIdentity, setFocusId, toggleFocus, clearFocus, filterProjects])

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
      identities: [],
      focusId: null,
      focusIdentity: null,
      setFocusId: () => {},
      toggleFocus: () => {},
      clearFocus: () => {},
      filterProjects: (projects) => projects,
    }
  }
  return ctx
}
