import { useState, useEffect, useRef } from 'react'
import { FONT, DIM, HI, LINE } from '../OverviewViews'

const SECTIONS = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'projects', label: 'PROJECTS' },
  { key: 'activity', label: 'ACTIVITY' },
]

export default function ShareScrollNav({ activeSection, color }) {
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
      <div ref={sentinelRef} style={{ height: 1 }} />
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: stuck ? 'rgba(18,18,18,0.95)' : 'transparent',
        backdropFilter: stuck ? 'blur(12px)' : 'none',
        borderBottom: `1px solid ${stuck ? 'rgba(255,255,255,0.08)' : LINE}`,
        transition: 'background 0.25s, backdrop-filter 0.25s',
        display: 'flex', gap: 2,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
        marginBottom: 8,
        opacity: 0,
        animation: 'shareReveal 0.5s ease-out 0.35s forwards',
      }}>
        {SECTIONS.map(s => {
          const active = activeSection === s.key
          return (
            <button key={s.key} onClick={() => scrollTo(s.key)} style={{
              background: active ? `${color}14` : 'transparent',
              border: 'none',
              borderTop: `2px solid ${active ? color : 'transparent'}`,
              cursor: 'pointer',
              padding: '10px 22px',
              fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
              color: active ? HI : DIM,
              transform: 'skewX(-6deg)',
              transition: 'color 0.15s, background 0.15s',
              fontFamily: FONT,
              outline: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>{s.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

export { SECTIONS }
