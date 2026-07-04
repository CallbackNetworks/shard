export default function ShareHero({ identity, summary: _summary, now, bp }) {
  const color = identity?.color || '#facc15'
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  const isMobile = bp === 'mobile'

  return (
    <div className="kt-share-hero" style={{ '--share-accent': color }}>
      <div className="kt-share-hero-grid">
        <div className="kt-share-avatar">
          {identity?.avatar || (identity?.name || 'U')[0].toUpperCase()}
        </div>

        <div className={isMobile ? 'kt-share-hero-copy is-mobile' : 'kt-share-hero-copy'}>
          <div className="kt-share-kicker">
            <span className="kt-share-signal-dot" />
            <span>PROJECT STATUS</span>
          </div>
          <h1 className="kt-share-title">
            {identity?.name || 'Loading...'}
          </h1>
          {identity?.description && (
            <p className="kt-share-description">
              {identity.description}
            </p>
          )}
        </div>

        <div className="kt-share-hero-meta">
          <span className="kt-share-badge">READ-ONLY</span>
          <span className="kt-share-time">
            {dateStr} {timeStr}
          </span>
        </div>
      </div>
    </div>
  )
}
