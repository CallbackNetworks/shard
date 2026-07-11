import { useState } from 'react'

export default function DonutChart({ segments = [], size = 120, strokeWidth = 10, centerText, centerSub }) {
  const [hover, setHover] = useState(null)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2
  const total = segments.reduce((s, seg) => s + seg.value, 0)

  let accumulated = 0
  const arcs = segments.filter(s => s.value > 0).map(seg => {
    const pct = total > 0 ? seg.value / total : 0
    const arcLen = pct * circumference
    const offset = -accumulated + circumference * 0.25
    accumulated += arcLen
    return { ...seg, arcLen, offset, pct }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.06)" strokeWidth={strokeWidth} />

      {total === 0 && (
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.1)" strokeWidth={strokeWidth} />
      )}

      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={hover === i ? arc.color : arc.color + 'cc'}
          strokeWidth={hover === i ? strokeWidth + 2 : strokeWidth}
          strokeDasharray={`${arc.arcLen} ${circumference - arc.arcLen}`}
          strokeDashoffset={arc.offset}
          strokeLinecap="butt"
          style={{ cursor: 'pointer', transition: 'stroke-width 0.15s, stroke 0.15s' }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}

      {centerText && (
        <text x={cx} y={centerSub ? cy - 4 : cy + 1} textAnchor="middle" dominantBaseline="middle"
          fontSize={size * 0.18} fontWeight="800" fill="var(--kt-ink)" fontFamily="system-ui">
          {centerText}
        </text>
      )}
      {centerSub && (
        <text x={cx} y={cy + size * 0.12} textAnchor="middle" dominantBaseline="middle"
          fontSize={size * 0.09} fill="rgba(var(--kt-ink-rgb), 0.4)" fontFamily="system-ui">
          {centerSub}
        </text>
      )}

      {hover !== null && arcs[hover] && (
        <g>
          <rect
            x={cx - 40} y={cy + radius + 6}
            width={80} height={22} rx={4}
            fill="rgba(0,0,0,0.85)" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={0.5}
          />
          <text x={cx} y={cy + radius + 20} textAnchor="middle" fontSize={10} fill="#fff" fontFamily="system-ui">
            {arcs[hover].label}: {arcs[hover].value} ({Math.round(arcs[hover].pct * 100)}%)
          </text>
        </g>
      )}
    </svg>
  )
}
