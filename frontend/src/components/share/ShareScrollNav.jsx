import { useState, useEffect, useRef } from 'react'

// `action` entries have no section on the page to scroll to — they raise something
// instead. ASK became one when the assistant moved out of the scroll flow and into a
// dock (ADR-0157): taking a thing out of the page must not take it out of the page's
// own table of contents, which is the only place a visitor learns it exists.
const SECTIONS = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'projects', label: 'PROJECTS' },
  { key: 'graph', label: 'STRUCTURE' },
  { key: 'decisions', label: 'DECISIONS' },
  { key: 'activity', label: 'ACTIVITY' },
  { key: 'ask', label: 'ASK', action: true },
]

export default function ShareScrollNav({ activeSection, activeAction, color, sections = SECTIONS, onAction }) {
  const [stuck, setStuck] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const scrollTo = (key) => {
    const el = document.getElementById(`share-section-${key}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div ref={sentinelRef} className="kt-share-nav-sentinel" />
      <div className={stuck ? 'kt-share-nav is-stuck' : 'kt-share-nav'} style={{ '--share-accent': color }}>
        {sections.map(s => {
          const active = s.action ? activeAction === s.key : activeSection === s.key
          return (
            <button
              key={s.key}
              className={[active ? 'is-active' : '', s.action ? 'is-action' : ''].filter(Boolean).join(' ')}
              onClick={() => (s.action ? onAction?.(s.key) : scrollTo(s.key))}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </>
  )
}

export { SECTIONS }
