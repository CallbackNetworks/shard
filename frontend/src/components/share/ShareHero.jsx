import { DIM, HI } from '../OverviewViews'

const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`
const PARA = (px = 8) => `polygon(${px}px 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

export default function ShareHero({ identity, summary: _summary, now, bp }) {
  const color = identity?.color || '#00f0ff'
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  const isMobile = bp === 'mobile'

  return (
    <div style={{
      position: 'relative',
      padding: isMobile ? '28px 20px' : '36px 36px 32px',
      marginBottom: 32,
      background: 'rgba(255,255,255,0.018)',
      borderTop: `1px solid ${color}33`,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      clipPath: isMobile ? 'none' : PARA_R(28),
      overflow: 'hidden',
      animation: 'shareReveal 0.6s ease-out forwards',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
        background: color,
      }} />

      <div style={{
        position: 'absolute', right: -60, top: -80, width: 240, height: 240,
        background: `radial-gradient(circle, ${color}14 0%, transparent 70%)`,
        animation: 'auroraFloat1 14s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', left: '30%', bottom: -60, width: 200, height: 200,
        background: `radial-gradient(circle, ${color}0c 0%, transparent 70%)`,
        animation: 'auroraFloat2 17s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'center' : 'flex-start',
        gap: isMobile ? 20 : 24,
        position: 'relative',
      }}>
        <div style={{
          width: 64, height: 64, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: identity?.avatar ? 32 : 26,
          fontWeight: 900,
          color: color,
          background: `${color}14`,
          border: `2px solid ${color}33`,
          borderRadius: '50%',
          boxShadow: `0 0 24px ${color}18, 0 0 48px ${color}0c`,
        }}>
          {identity?.avatar || (identity?.name || 'U')[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, textAlign: isMobile ? 'center' : 'left', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: isMobile ? 'center' : 'flex-start', marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, background: color, clipPath: PARA(3), flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              PROJECT STATUS
            </span>
          </div>
          <h1 style={{
            margin: '0 0 6px', fontSize: isMobile ? 22 : 26, fontWeight: 900,
            color: HI, letterSpacing: '-0.02em', lineHeight: 1.15,
          }}>
            {identity?.name || 'Loading...'}
          </h1>
          {identity?.description && (
            <p style={{
              margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)',
              lineHeight: 1.5, maxWidth: 480,
            }}>
              {identity.description}
            </p>
          )}
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-end',
          gap: 8, flexShrink: 0,
        }}>
          <span style={{
            fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.18em',
            textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '3px 10px',
            transform: 'skewX(-5deg)',
            display: 'inline-block',
          }}>
            <span style={{ display: 'inline-block', transform: 'skewX(5deg)' }}>READ-ONLY</span>
          </span>
          <span style={{
            fontSize: 11, color: 'rgba(255,255,255,0.15)',
            letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums',
          }}>
            {dateStr} {timeStr}
          </span>
        </div>
      </div>
    </div>
  )
}
