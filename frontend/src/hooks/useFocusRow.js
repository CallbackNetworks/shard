import { useEffect } from 'react'

// How long the landed row stays lit. Long enough to find with your eyes after a
// scroll, short enough not to read as a selection state.
const FLASH_MS = 1800
// The row is rendered by the same React commit that changed the URL, but a view
// switch, a filter relaxation and an image-driven reflow all land a frame or two
// later. Polling beats a single rAF for the same reason the ancestry strip batches:
// the alternative is a guess at the slowest case.
const RETRY_MS = 90
const MAX_ATTEMPTS = 14

const escapeId = (id) =>
  (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"')

/**
 * Scroll the row a deep link names into view and flash it (ADR-0147).
 *
 * Every task view marks its row root with `data-focus-id`, so this hook is the one
 * place that knows how a link becomes a position on screen — the board, the table,
 * the timeline, the calendar and the issue list differ in everything except that
 * attribute. Searching the document rather than holding a ref is deliberate: the
 * five views are five component trees and a ref would have to be threaded through
 * all of them plus every wrapper between.
 *
 * `pass` exists because the caller's recovery ladder (relax the filters, then switch
 * to the list view) does not change `focusId` — without it the effect would not rerun
 * and the second rung would never be tried.
 *
 * `onMissing` fires once per pass when the row never appears. It is not an error:
 * the row is legitimately absent when a filter hides it or the task is a subtask
 * under a collapsed parent, and deciding what to do about that is the caller's.
 */
export default function useFocusRow(focusId, { pass = 0, enabled = true, onLanded, onMissing } = {}) {
  useEffect(() => {
    if (!focusId || !enabled) return undefined
    let cancelled = false
    let attempts = 0
    let retry
    let clearFlash

    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(`[data-focus-id="${escapeId(focusId)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('kt-focus-flash')
        clearFlash = setTimeout(() => el.classList.remove('kt-focus-flash'), FLASH_MS)
        onLanded?.(el)
        return
      }
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        onMissing?.()
        return
      }
      retry = setTimeout(tick, RETRY_MS)
    }
    tick()

    return () => {
      cancelled = true
      clearTimeout(retry)
      clearTimeout(clearFlash)
    }
    // The callbacks are intentionally out of the dependency list: a caller defining
    // them inline would otherwise restart the search on every render, which resets
    // `attempts` and turns "give up after 14 tries" into "never give up".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, pass, enabled])
}
