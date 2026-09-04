import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { useTour } from './TourContext'
import { tourForPath } from './tours'
import s from './PageTourLauncher.module.css'

/**
 * The way into this page's tour (ADR-0152).
 *
 * One mount point, in the layout, rather than a button added to eighteen page
 * headers. Those headers are not one component — some are `.kt-page-header`, the
 * project page and the assistant each roll their own — so "put it in the header"
 * means eighteen edits and eighteen chances for it to drift out of one of them.
 * This asks the registry which tour belongs to the current path and draws itself, or
 * does not.
 *
 * Fixed to the bottom-left, which is the last corner still free: the assistant owns
 * bottom-right and the offline indicator owns bottom-centre. It reads `--rail-w`
 * rather than a literal, because the rail's width is a user preference and anything
 * pinned to the left edge that hardcodes 72px sits on top of the rail the moment
 * somebody expands it (ADR-0088).
 *
 * The dot is the whole reason this is discoverable at all: a tour nobody knows about
 * is a tour nobody takes, and a page you have never had explained is exactly the
 * page where a quiet marker earns its ink. It goes away for good once you have
 * walked that page's tour, so it is a fact about you rather than a permanent
 * decoration.
 */
export default function PageTourLauncher() {
  const { t } = useTranslation()
  const location = useLocation()
  const { start, active, hasSeen } = useTour()

  const tour = tourForPath(location.pathname)
  // Hidden while a tour runs: the button that starts the thing on screen is noise,
  // and it would sit under the scrim looking disabled.
  if (!tour || active) return null

  const unseen = !hasSeen(tour.id)

  return (
    <button
      type="button"
      data-tour="page-tour"
      className={s.launcher}
      onClick={() => start(tour.id)}
      title={t('tour.launchTitle', { name: t(tour.nameKey) })}
    >
      <Compass size={14} />
      <span className={s.label}>{t('tour.launch')}</span>
      {unseen && <span className={s.dot} aria-hidden="true" />}
      {unseen && <span className="kt-sr-only">{t('tour.launchUnseen')}</span>}
    </button>
  )
}
