import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPreference, setPreference } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { TOURS, tourById, tourForPath } from './tours'

const PREF_KEY = 'tour-state'

const TourContext = createContext(null)

/**
 * Which tour is running, where it is, and which ones have been seen (ADR-0152).
 *
 * State lives in a context rather than in the overlay because four unrelated places
 * start a tour: the first visit, the launcher that sits on every page, the guide's
 * list of tours, and the keyboard help modal. An overlay owning its own state would
 * mean each of those needs a handle on the overlay.
 *
 * "Seen" is a server preference, not localStorage: the same account on a second
 * machine has already been shown this, and being walked through the product again on
 * every device is the kind of thing people remember about software.
 *
 * The stored shape is `{ seen, at, tours: { [id]: true } }`. `seen` predates the
 * per-page tours and is kept meaning "the introduction is done" rather than migrated
 * away — `e2e/global-setup.ts` writes exactly that key to put the suite in the
 * returning-user state (ADR-0151), and a rename here would silently restore the
 * first-visit behaviour it exists to prevent.
 */
export function TourProvider({ children }) {
  const qc = useQueryClient()
  const location = useLocation()
  const { data: saved, isLoading } = useQuery({
    queryKey: qk.preference(PREF_KEY),
    queryFn: () => getPreference(PREF_KEY),
    staleTime: 300000,
  })
  // `{ tour, index }`, or null when nothing is running.
  const [run, setRun] = useState(null)

  const state = saved?.value || {}

  const persist = useCallback((patch) => {
    const current = qc.getQueryData(qk.preference(PREF_KEY))?.value || {}
    const value = { ...current, ...patch, at: new Date().toISOString() }
    setPreference(PREF_KEY, value).catch(() => {})
    qc.setQueryData(qk.preference(PREF_KEY), { value })
  }, [qc])

  const markSeen = useCallback((tourId) => {
    const current = qc.getQueryData(qk.preference(PREF_KEY))?.value || {}
    persist({
      // The introduction is what `seen` has always meant, so only it sets that flag.
      seen: tourId === 'overview' ? true : current.seen,
      tours: { ...(current.tours || {}), [tourId]: true },
    })
  }, [persist, qc])

  const start = useCallback((tourId) => {
    const tour = tourById(tourId) || tourForPath(location.pathname)
    if (!tour) return
    setRun({ tour, index: 0 })
  }, [location.pathname])

  const stop = useCallback(() => {
    setRun(r => {
      if (r) markSeen(r.tour.id)
      return null
    })
  }, [markSeen])

  const back = useCallback(() => {
    setRun(r => (r ? { ...r, index: Math.max(0, r.index - 1) } : r))
  }, [])

  // Reaching the end is finishing, and it marks itself seen the same way skipping
  // does — otherwise completing a tour is the one path that leaves it set to run
  // again on the next load.
  const advance = useCallback(() => {
    setRun(r => {
      if (!r) return r
      if (r.index + 1 >= r.tour.steps.length) {
        markSeen(r.tour.id)
        return null
      }
      return { ...r, index: r.index + 1 }
    })
  }, [markSeen])

  /* The introduction offers itself on a first visit. Three guards, each for a defect
     seen rather than imagined:

     `isLoading` — an absent preference and a not-yet-fetched one are both falsy, so
     without it the tour fires for a returning user in the moment before their
     preference arrives, then vanishes. Worse than either behaviour alone.

     The **route** — a first-time visitor who opened `/guide` was carried straight off
     it by the overlay's own navigation. Asking for the manual and being handed a tour
     instead is the version of "helpful" that people turn off.

     `run` — so a skip is not immediately undone.

     Note what is deliberately *not* here: the other seventeen tours never start
     themselves. They are the answer to "what is this screen", which is a question
     somebody asks; firing one on every new page would make moving through the
     product feel like being followed. */
  useEffect(() => {
    if (isLoading) return
    if (state.seen) return
    if (run !== null) return
    if (location.pathname !== '/') return
    setRun({ tour: TOURS.find(tr => tr.auto), index: 0 })
    // Intentionally not depending on `run`: this decides once, on load. Adding it
    // restarts the tour the moment the user skips it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, state.seen, location.pathname])

  const value = useMemo(() => ({
    tour: run?.tour || null,
    index: run?.index ?? null,
    active: run !== null,
    step: run ? run.tour.steps[run.index] : null,
    total: run ? run.tour.steps.length : 0,
    // What the launcher and the guide need: has this one been walked before?
    // `state.tours` is read inside rather than lifted to a `|| {}` above it — the
    // fallback object is a new identity on every render, which makes this memo
    // recompute every time and the launcher re-render with it.
    hasSeen: (tourId) => !!state.tours?.[tourId] || (tourId === 'overview' && !!state.seen),
    start, stop, back, advance,
  }), [run, state.tours, state.seen, start, stop, back, advance])

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

// A default rather than a throw: the tour is an enhancement, and a component
// rendered in a test without the provider should keep working rather than crash.
const INERT = {
  tour: null, index: null, active: false, step: null, total: 0,
  hasSeen: () => true,
  start: () => {}, stop: () => {}, back: () => {}, advance: () => {},
}

export function useTour() {
  return useContext(TourContext) || INERT
}
