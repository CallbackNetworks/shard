import { useState } from 'react'

const MEDALS = ['🥇', '🥈', '🥉']

export default function HorizontalBarChart({ items = [], maxValue, showMedals = true, height }) {
  const [hover, setHover] = useState(null)

  if (items.length === 0) return null

  const max = maxValue || Math.max(...items.map(i => i.value), 1)
  const barH = 28
  const gap = 6
  const PAD = { l: 130, r: 60, t: 8, b: 8 }
  const W = 600
  const H = height || (items.length * (barH + gap) + PAD.t + PAD.b)
  const innerW = W - PAD.l - PAD.r

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {items.map((item, i) => {
        const y = PAD.t + i * (barH + gap)
        const w = (item.value / max) * innerW
        const isHov = hover === i
        return (
          <g key={item.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          >
            <text x={PAD.l - 8} y={y + barH / 2 + 1}
              textAnchor="end" dominantBaseline="middle"
              fontSize={11} fill={isHov ? '#fff' : 'rgba(255,255,255,0.55)'} fontFamily="system-ui">
              {showMedals && i < 3 ? MEDALS[i] + ' ' : ''}
              {item.label.length > 12 ? item.label.slice(0, 10) + '..' : item.label}
            </text>

            <rect x={PAD.l} y={y} width={innerW} height={barH} rx={4}
              fill="rgba(255,255,255,0.03)" />

            <rect x={PAD.l} y={y} width={Math.max(w, 2)} height={barH} rx={4}
              fill={item.color || '#ef4444'}
              opacity={isHov ? 1 : 0.75}
            />

            {isHov && w > 0 && (
              <rect x={PAD.l} y={y} width={Math.max(w, 2)} height={barH} rx={4}
                fill="rgba(255,255,255,0.08)" />
            )}

            <text x={PAD.l + Math.max(w, 2) + 8} y={y + barH / 2 + 1}
              dominantBaseline="middle"
              fontSize={11} fontWeight={700}
              fill={isHov ? '#fff' : 'rgba(255,255,255,0.4)'} fontFamily="system-ui">
              {item.displayValue || item.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
