import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPreference, setPreference } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { TOUR_STEPS } from './tourSteps'

const PREF_KEY = 'tour-state'

const TourContext = createContext(null)

/**
 * Whether the tour is running, and where it is (ADR-0148).
 *
 * State lives in a context rather than in the overlay because three unrelated
 * places start it: the first visit, the guide's replay button, and the keyboard
 * help modal. An overlay owning its own state would mean each of those needs a
 * handle on the overlay.
 *
 * "Seen" is a server preference, not localStorage: the same account on a second
 * machine has already been shown this, and being walked through the product again
 * on every device is the kind of thing people remember about software.
 */
export function TourProvider({ children }) {
  const qc = useQueryClient()
  const location = useLocation()
  const { data: saved, isLoading } = useQuery({
    queryKey: qk.preference(PREF_KEY),
    queryFn: () => getPreference(PREF_KEY),
    staleTime: 300000,
  })
  const [index, setIndex] = useState(null)

  const persist = useCallback((value) => {
    setPreference(PREF_KEY, value).catch(() => {})
    qc.setQueryData(qk.preference(PREF_KEY), { value })
  }, [qc])

  const start = useCallback(() => setIndex(0), [])

  const finish = useCallback(() => {
    setIndex(null)
    persist({ seen: true, at: new Date().toISOString() })
  }, [persist])

  const next = useCallback(() => {
    setIndex(i => (i == null ? i : i + 1 >= TOUR_STEPS.length ? null : i + 1))
  }, [])
  const back = useCallback(() => setIndex(i => (i == null ? i : Math.max(0, i - 1))), [])

  // Reaching the end is finishing, and it has to mark itself seen the same way
  // skipping does — otherwise completing the tour is the one path that leaves it
  // set to run again on the next load.
  const advance = useCallback(() => {
    setIndex(i => {
      if (i == null) return i
      if (i + 1 >= TOUR_STEPS.length) {
        persist({ seen: true, at: new Date().toISOString() })
        return null
      }
      return i + 1
    })
  }, [persist])

  /* First visit starts the tour. Three guards, each for a defect seen rather than
     imagined:

     `isLoading` — an absent preference and a not-yet-fetched one are both falsy, so
     without it the tour fires for a returning user in the moment before their
     preference arrives, then vanishes. Worse than either behaviour alone.

     The **route** — the first step lives on `/`, and the overlay navigates to a
     step's route, so a first-time visitor who opened `/guide` was carried straight
     off it. Asking for the manual and being handed a tour instead is the version of
     "helpful" that people turn off. The tour offers itself where it belongs and
     nowhere else; the guide's replay button is how you ask for it from elsewhere.

     `index` — so a skip is not immediately undone. */
  useEffect(() => {
    if (isLoading) return
    if (saved?.value?.seen) return
    if (index !== null) return
    if (location.pathname !== '/') return
    setIndex(0)
    // Intentionally not depending on `index`: this decides once, on load. Adding it
    // restarts the tour the moment the user skips it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, saved, location.pathname])

  const value = useMemo(() => ({
    steps: TOUR_STEPS,
    index,
    active: index !== null,
    step: index === null ? null : TOUR_STEPS[index],
    start, finish, next, back, advance,
  }), [index, start, finish, next, back, advance])

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

// A default rather than a throw: the tour is an enhancement, and a component
// rendered in a test without the provider should keep working rather than crash.
const INERT = { steps: TOUR_STEPS, index: null, active: false, step: null, start: () => {}, finish: () => {}, next: () => {}, back: () => {}, advance: () => {} }

export function useTour() {
  return useContext(TourContext) || INERT
}
