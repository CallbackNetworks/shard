import { useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router'
import { useTour } from './TourContext'
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
 * The spotlight (ADR-0148).
 *
 * Rendered through a portal to `document.body`, and this is load-bearing rather
 * than tidy: an entrance animation with `fill-mode: both` leaves a transform on the
 * route shell, and a transformed ancestor becomes the containing block for
 * `position: fixed` — so an overlay rendered in place is offset by however far down
 * the page that ancestor starts, and clipped by anything between. ADR-0122 hit this
 * with a popover and ADR-0129 with a modal; a full-screen overlay is the version of
 * it that is impossible to miss and equally impossible to debug from the code.
 *
 * The hole is four <div>s around the target rather than an SVG mask or a giant
 * `box-shadow`: it means the area inside the cut-out receives no pointer events at
 * all, so the highlighted control stays clickable during the step that describes it.
 */
export default function TourOverlay() {
  const { t } = useTranslation()
  const { active, step, index, steps, advance, back, finish } = useTour()
  const navigate = useNavigate()
  const location = useLocation()
  const [rect, setRect] = useState(null)
  const [missing, setMissing] = useState(false)

  // Get to the step's page before looking for its anchor.
  useEffect(() => {
    if (!active || !step?.route) return
    if (location.pathname !== step.route) navigate(step.route)
  }, [active, step, location.pathname, navigate])

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
  // Overview are individually hideable, so this is a normal state, not a defect.
  useEffect(() => { if (missing) advance() }, [missing, advance])

  const onKey = useCallback((e) => {
    if (e.key === 'Escape') finish()
    else if (e.key === 'ArrowRight' || e.key === 'Enter') advance()
    else if (e.key === 'ArrowLeft') back()
  }, [finish, advance, back])

  useEffect(() => {
    if (!active) return undefined
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onKey])

  if (!active || !step || !rect) return null

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

  const last = index === steps.length - 1

  return createPortal(
    <div className={s.root} role="dialog" aria-modal="true" aria-label={t('tour.title')}>
      {/* Four panes, not a mask: the gap between them is a real hole, so the
          highlighted control is still clickable while it is being described. */}
      <div className={s.scrim} style={{ top: 0, left: 0, width: '100%', height: Math.max(0, rect.top) }} />
      <div className={s.scrim} style={{ top: rect.top + rect.height, left: 0, width: '100%', bottom: 0 }} />
      <div className={s.scrim} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} />
      <div className={s.scrim} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
      <div className={s.ring} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />

      <div className={s.bubble} style={{ ...bubble, width: BUBBLE_W }}>
        <div className={s.count}>{t('tour.progress', { current: index + 1, total: steps.length })}</div>
        <h2 className={s.title}>{t(step.titleKey)}</h2>
        <p className={s.body}>{t(step.bodyKey)}</p>
        <div className={s.actions}>
          <button type="button" className={s.skip} onClick={finish}>{t('tour.skip')}</button>
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
