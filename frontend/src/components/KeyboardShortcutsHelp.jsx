import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useLocation } from 'react-router'
import { BookOpen, PlayCircle } from 'lucide-react'
import { DARK, RADIUS, FONT } from '../constants/theme'
import { useTour } from './tour/TourContext'
import { tourForPath, tourById } from './tour/tours'

const SHORTCUTS = [
  { keys: ['c'],      i18nKey: 'shortcuts.createTask' },
  { keys: ['n'],      i18nKey: 'shortcuts.createProject' },
  { keys: ['/'],      i18nKey: 'shortcuts.search' },
  { keys: ['?'],      i18nKey: 'shortcuts.showHelp' },
  { keys: ['g', 'h'], i18nKey: 'shortcuts.goHome' },
  { keys: ['g', 'a'], i18nKey: 'shortcuts.goAnalytics' },
  { keys: ['g', 'i'], i18nKey: 'shortcuts.goIdentities' },
  { keys: ['g', 'g'], i18nKey: 'shortcuts.goGoals' },
  { keys: ['g', 'p'], i18nKey: 'shortcuts.switchProject' },
]

function KeyBadge({ children }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        padding: '0 6px',
        background: 'rgba(var(--kt-ink-rgb), 0.1)',
        border: '1px solid rgba(var(--kt-ink-rgb), 0.2)',
        borderRadius: RADIUS.sm,
        fontFamily: FONT.mono,
        fontSize: FONT.sm,
        color: DARK.text,
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  )
}

export default function KeyboardShortcutsHelp({ open, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { start: startTour } = useTour()

  // Close on Escape
  useEffect(() => {
    if (!open) return

    function handler(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose?.()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: DARK.elevated,
          borderRadius: RADIUS.lg,
          border: `1px solid ${DARK.borderMid}`,
          maxWidth: 400,
          width: '90vw',
          padding: '24px',
          boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px',
        }}
      >
        <h2
          style={{
            margin: '0 0 20px 0',
            fontSize: FONT.xl,
            fontWeight: 600,
            color: DARK.text,
          }}
        >
          {t('shortcuts.title', 'Keyboard Shortcuts')}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SHORTCUTS.map(({ keys, i18nKey }) => (
            <div
              key={i18nKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span
                style={{
                  fontSize: FONT.md,
                  color: DARK.textMid,
                  flex: 1,
                }}
              >
                {t(i18nKey, i18nKey)}
              </span>
              <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {keys.map((k, idx) => (
                  <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {idx > 0 && (
                      <span style={{ fontSize: FONT.xs, color: DARK.textDim }}>then</span>
                    )}
                    <KeyBadge>{k}</KeyBadge>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>

        {/* `?` is the gesture for "I need help", and until now the only thing behind
            it was a key list — useful once you already know what the keys are for.
            The guide and the tour are the two answers to the question actually being
            asked, so this is where they belong (ADR-0148). */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${DARK.border}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            to="/guide"
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              border: `1px solid ${DARK.borderMid}`, borderRadius: RADIUS.md,
              color: DARK.textMid, fontSize: FONT.md, padding: '6px 12px', textDecoration: 'none',
            }}
          >
            <BookOpen size={13} /> {t('guide.title')}
          </Link>
          {/* Whichever tour belongs to the page the question was asked from, falling
              back to the introduction. `?` is pressed while standing somewhere, and
              always replaying the front-door tour answers a question nobody asked
              from any of the other seventeen screens (ADR-0152). */}
          <button
            onClick={() => {
              const tour = tourForPath(location.pathname) || tourById('overview')
              onClose()
              if (tour.route && tour.route !== location.pathname) navigate(tour.route)
              startTour(tour.id)
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${DARK.borderMid}`, borderRadius: RADIUS.md,
              color: DARK.textMid, fontSize: FONT.md, padding: '6px 12px', cursor: 'pointer',
            }}
          >
            <PlayCircle size={13} /> {t('tour.launch')}
          </button>
        </div>

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(var(--kt-ink-rgb), 0.1)',
              border: `1px solid ${DARK.borderMid}`,
              borderRadius: RADIUS.md,
              color: DARK.textMid,
              fontSize: FONT.md,
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
