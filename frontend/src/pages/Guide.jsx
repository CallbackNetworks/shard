import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate, Link } from 'react-router'
import { BookOpen, PlayCircle, X } from 'lucide-react'
import MarkdownPreview from '../components/MarkdownPreview'
import { guideChapters } from '../guide'
import { useTour } from '../components/tour/TourContext'
import s from './Guide.module.css'

/**
 * The illustrated guide (ADR-0148).
 *
 * The product had no in-app explanation of itself at all: `GettingStarted` was four
 * lines of text shown only while you had zero projects, and the repo's visual tour
 * lived in `docs/`, which the frontend image's build context does not include — so
 * it could be read by somebody browsing the source and by nobody using the app.
 *
 * The chapter is in the URL because a guide is a thing people link each other to,
 * and because "go read the section on decisions" has to be a link, not directions.
 */
export default function Guide() {
  const { t, i18n } = useTranslation()
  const { chapter: slug } = useParams()
  const navigate = useNavigate()
  const { start: startTour } = useTour()
  const chapters = guideChapters(i18n.language)
  const active = chapters.find(c => c.slug === slug) || chapters[0]
  const [lightbox, setLightbox] = useState(null)

  // A chapter change is a navigation to the top of a new document, not a scroll
  // position to preserve. Without this, following a link to a later chapter leaves
  // you halfway down it.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [active?.slug])

  // Clicking a screenshot opens it full size: the images are captured at 1440px and
  // drawn at roughly half that in the column, which is legible for layout and not
  // for the text inside them.
  useEffect(() => {
    if (!lightbox) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  /* The screenshots are rendered by the markdown editor, so they arrive as plain
     <img> with no way to reach them from the keyboard. Zooming one is the only
     interaction on this page, and leaving it mouse-only would make the pictures —
     the whole point of an illustrated guide — unusable for anyone not using one.
     Marked up after render rather than by a custom node view, because a node view
     would be a second renderer for the sake of two attributes. */
  useEffect(() => {
    const imgs = document.querySelectorAll(`.${s.prose} img`)
    imgs.forEach(img => {
      img.setAttribute('tabindex', '0')
      img.setAttribute('role', 'button')
      if (!img.getAttribute('alt')) img.setAttribute('alt', t('guide.imageFull'))
    })
  }, [active?.slug, t])

  const openFromEvent = (e) => {
    if (e.target.tagName !== 'IMG') return
    setLightbox(e.target.getAttribute('src'))
  }
  const onContentKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target.tagName !== 'IMG') return
      e.preventDefault()
      openFromEvent(e)
    }
  }

  if (!active) return <div className={s.empty}>{t('guide.noChapters')}</div>

  return (
    <div className={s.root}>
      <aside className={s.nav} aria-label={t('guide.title')}>
        <div className={s.navHeader}>
          <BookOpen size={14} />
          <span>{t('guide.title')}</span>
        </div>
        <nav className={s.navList}>
          {chapters.map((c, i) => (
            <Link
              key={c.slug}
              to={`/guide/${c.slug}`}
              className={c.slug === active.slug ? `${s.navItem} ${s.navItemActive}` : s.navItem}
            >
              <span className={s.navNum}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.navLabel}>{c.title}</span>
            </Link>
          ))}
        </nav>
        {/* The guide and the tour are two answers to the same question, so the way
            into the other one belongs on each. Replaying the tour from here is the
            only way back to it once it has been completed or skipped. */}
        <button type="button" className={s.tourBtn} onClick={() => { startTour(); navigate('/') }}>
          <PlayCircle size={14} />
          {t('guide.replayTour')}
        </button>
      </aside>

      <article className={s.content} onClick={openFromEvent} onKeyDown={onContentKeyDown}>
        <MarkdownPreview content={active.body} className={s.prose} />
      </article>

      {lightbox && (
        <div
          className={s.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={t('guide.imageFull')}
          onClick={() => setLightbox(null)}
        >
          <button type="button" className={s.lightboxClose} aria-label={t('close')}>
            <X size={18} />
          </button>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  )
}
