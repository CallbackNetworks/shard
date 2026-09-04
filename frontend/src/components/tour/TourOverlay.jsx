import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router'
import { useTour } from './TourContext'
import { stepKeys } from './tours'
import s from './TourOverlay.module.css'

// How long to keep looking for a step's anchor before deciding it is not there.
// A route change plus a data fetch is the slow case; beyond this the step is
// genuinely absent (a widget the user hid, a page that failed to load) and the
// tour moves on rather than stalling on a highlight that will never appear.
const ANCHOR_TIMEOUT_MS = 2500
const POLL_MS = 80
// Breathing room between the cut-out and the element inside it.
const PAD = 6
const BUBBLE_W = 320
const GAP = 14

function rectOf(el) {
  const r = el.getBoundingClientRect()
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

/**
 * The spotlight (ADR-0148, ADR-0152).
 *
 * Rendered through a portal to `document.body`, and this is load-bearing rather
 * than tidy: an entrance animation with `fill-mode: both` leaves a transform on the
 * route shell, and a transformed ancestor becomes the containing block for
 * `position: fixed` — so an overlay rendered in place is offset by however far down
 * the page that ancestor starts, and clipped by anything between. ADR-0122 hit this
 * with a popover and ADR-0129 with a modal; a full-screen overlay is the version of
 * it that is impossible to miss and equally impossible to debug from the code.
 *
 * **The scrim does not take pointer events.** It used to, and ADR-0151 is the bill:
 * every `locator.click()` in the integration suite timed out against a fresh prod
 * stack, because a fresh database is a first visit and the tour was covering the
 * whole page. That ADR set a preference in the e2e global setup so the other twenty
 * tests could run and said plainly that the real fix had not been made. This is it —
 * the tour dims the page it is describing and never blocks it, so the control being
 * explained is not the only thing on screen you can still use. A person who wants to
 * *try* the thing mid-step can, which is the behaviour a tutorial should have had
 * from the start.
 */
export default function TourOverlay() {
  const { t } = useTranslation()
  const { active, tour, step, index, total, advance, back, stop } = useTour()
  const navigate = useNavigate()
  const location = useLocation()
  const [rect, setRect] = useState(null)
  const [missing, setMissing] = useState(false)
  // Which tour we have already navigated for. Without it the effect below fights
  // the user: they click a rail row mid-tour and are dragged back, every time.
  const routedFor = useRef(null)

  // Get to the tour's page once, when it starts. A tour with no `route` (the project
  // one) is only ever offered from a page that already matches it.
  useEffect(() => {
    if (!active) { routedFor.current = null; return }
    if (!tour?.route) return
    if (routedFor.current === tour.id) return
    routedFor.current = tour.id
    if (location.pathname !== tour.route) navigate(tour.route)
  }, [active, tour, location.pathname, navigate])

  // Leaving the page ends the tour. With a scrim that no longer traps clicks this
  // is reachable, and it is the honest reading of the act: a tour of this screen is
  // over when you are not on this screen. Silently continuing would point a
  // highlight at whatever now happens to sit at those coordinates.
  const startedAt = useRef(null)
  useEffect(() => {
    if (!active) { startedAt.current = null; return }
    // The page this tour belongs on — `tour.route` and not wherever we happen to be
    // standing when it starts, because the effect above is about to navigate there
    // and reading the pre-navigation path would make the tour stop itself on step one.
    if (startedAt.current === null) { startedAt.current = tour?.route || location.pathname; return }
    if (startedAt.current !== location.pathname) stop()
  }, [active, tour, location.pathname, stop])

  // Find the anchor, then track it. useLayoutEffect so the first paint of a step
  // already has its position — measured in an effect, every step visibly jumps from
  // the previous step's rectangle.
  useLayoutEffect(() => {
    if (!active || !step) { setRect(null); setMissing(false); return undefined }
    setMissing(false)
    let cancelled = false
    let timer
    const started = Date.now()

    const find = () => {
      if (cancelled) return
      const el = document.querySelector(step.anchor)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setRect(rectOf(el))
        return
      }
      if (Date.now() - started > ANCHOR_TIMEOUT_MS) { setMissing(true); return }
      timer = setTimeout(find, POLL_MS)
    }
    find()

    const track = () => {
      const el = document.querySelector(step.anchor)
      if (el) setRect(rectOf(el))
    }
    window.addEventListener('resize', track)
    window.addEventListener('scroll', track, true)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('resize', track)
      window.removeEventListener('scroll', track, true)
    }
  }, [active, step])

  // A step whose anchor is not there is skipped, not shown empty. Widgets on the
  // Overview are individually hideable and several pages only render a panel once
  // they hold something, so this is a normal state, not a defect.
  useEffect(() => { if (missing) advance() }, [missing, advance])

  const onKey = useCallback((e) => {
    if (e.key === 'Escape') stop()
    else if (e.key === 'ArrowRight') advance()
    else if (e.key === 'ArrowLeft') back()
  }, [stop, advance, back])

  useEffect(() => {
    if (!active) return undefined
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onKey])

  if (!active || !step || !rect) return null

  const { titleKey, bodyKey } = stepKeys(tour, step)
  const vw = window.innerWidth
  const vh = window.innerHeight
  // The declared placement is a preference. A bubble that would sit off-screen is
  // flipped rather than clamped against the edge, because clamping puts it on top
  // of the thing it is pointing at.
  let placement = step.placement || 'bottom'
  if (placement === 'bottom' && rect.top + rect.height + GAP + 160 > vh) placement = 'top'
  if (placement === 'top' && rect.top - GAP - 160 < 0) placement = 'bottom'
  if (placement === 'right' && rect.left + rect.width + GAP + BUBBLE_W > vw) placement = 'left'
  if (placement === 'left' && rect.left - GAP - BUBBLE_W < 0) placement = 'right'

  const bubble = {}
  if (placement === 'bottom') {
    bubble.top = rect.top + rect.height + GAP
    bubble.left = Math.min(Math.max(8, rect.left), vw - BUBBLE_W - 8)
  } else if (placement === 'top') {
    bubble.bottom = vh - rect.top + GAP
    bubble.left = Math.min(Math.max(8, rect.left), vw - BUBBLE_W - 8)
  } else if (placement === 'right') {
    bubble.left = rect.left + rect.width + GAP
    bubble.top = Math.min(Math.max(8, rect.top), vh - 200)
  } else {
    bubble.right = vw - rect.left + GAP
    bubble.top = Math.min(Math.max(8, rect.top), vh - 200)
  }

  const last = index === total - 1

  return createPortal(
    /* `role="dialog"` without `aria-modal`, deliberately: the page underneath is
       still live and still reachable, so claiming otherwise to a screen reader would
       be the one description of this overlay that is now false. */
    <div className={s.root} role="dialog" aria-label={t('tour.title')}>
      {/* Four panes, not a mask or a giant box-shadow: the gap between them is a
          real hole, so the highlighted control is drawn at full brightness. None of
          them takes pointer events (ADR-0152). */}
      <div className={s.scrim} style={{ top: 0, left: 0, width: '100%', height: Math.max(0, rect.top) }} />
      <div className={s.scrim} style={{ top: rect.top + rect.height, left: 0, width: '100%', bottom: 0 }} />
      <div className={s.scrim} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} />
      <div className={s.scrim} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
      <div className={s.ring} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />

      <div className={s.bubble} style={{ ...bubble, width: BUBBLE_W }}>
        <div className={s.head}>
          <span className={s.tourName}>{t(tour.nameKey)}</span>
          <span className={s.count}>{t('tour.progress', { current: index + 1, total })}</span>
        </div>
        <h2 className={s.title}>{t(titleKey)}</h2>
        <p className={s.body}>{t(bodyKey)}</p>
        <div className={s.actions}>
          <button type="button" className={s.skip} onClick={stop}>{t('tour.skip')}</button>
          <div className={s.actionsRight}>
            {index > 0 && (
              <button type="button" className={s.back} onClick={back}>{t('tour.back')}</button>
            )}
            <button type="button" className={s.next} onClick={advance}>
              {last ? t('tour.done') : t('tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
