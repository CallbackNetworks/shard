import { useState, useEffect, useRef } from 'react'

const SECTIONS = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'projects', label: 'PROJECTS' },
  { key: 'decisions', label: 'DECISIONS' },
  { key: 'ask', label: 'ASK' },
  { key: 'activity', label: 'ACTIVITY' },
]

export default function ShareScrollNav({ activeSection, color, sections = SECTIONS }) {
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
          const active = activeSection === s.key
          return (
            <button
              key={s.key}
              className={active ? 'is-active' : ''}
              onClick={() => scrollTo(s.key)}
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
