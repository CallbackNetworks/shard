import { useState } from 'react'

export default function StackedBarChart({ bars = [], segments = [], height = 220, horizontal = false }) {
  const [hover, setHover] = useState(null)

  if (bars.length === 0) return null

  const W = 600
  const H = horizontal ? Math.max(bars.length * 36 + 40, 120) : height
  const PAD = horizontal
    ? { t: 10, r: 40, b: 10, l: 120 }
    : { t: 10, r: 10, b: 40, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const maxVal = Math.max(...bars.map(b =>
    segments.reduce((s, seg) => s + (b.values[seg.key] || 0), 0)
  ), 1)

  if (horizontal) {
    const barH = 24
    const gap = 8
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {bars.map((bar, i) => {
          const y = PAD.t + i * (barH + gap)
          let xOffset = PAD.l
          const isHov = hover === i
          return (
            <g key={bar.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            >
              <text x={PAD.l - 8} y={y + barH / 2 + 1}
                textAnchor="end" dominantBaseline="middle"
                fontSize={11} fill={isHov ? 'var(--kt-ink)' : 'rgba(var(--kt-ink-rgb), 0.5)'} fontFamily="system-ui">
                {bar.label.length > 14 ? bar.label.slice(0, 12) + '...' : bar.label}
              </text>
              {segments.map(seg => {
                const val = bar.values[seg.key] || 0
                const w = (val / maxVal) * innerW
                const rect = (
                  <rect key={seg.key}
                    x={xOffset} y={y} width={w} height={barH} rx={i === 0 ? 3 : 0}
                    fill={isHov ? seg.color : seg.color + 'bb'}
                  />
                )
                xOffset += w
                return rect
              })}
              <text x={xOffset + 6} y={y + barH / 2 + 1}
                dominantBaseline="middle"
                fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.3)" fontFamily="system-ui">
                {segments.reduce((s, seg) => s + (bar.values[seg.key] || 0), 0)}
              </text>
            </g>
          )
        })}

        {hover !== null && bars[hover] && (() => {
          const bar = bars[hover]
          const y = PAD.t + hover * (barH + gap)
          const lines = segments.filter(s => bar.values[s.key]).map(s => `${s.label}: ${bar.values[s.key]}`)
          const text = `${bar.label}\n${lines.join('\n')}`
          const textLines = text.split('\n')
          const boxW = Math.max(...textLines.map(l => l.length)) * 6.5 + 16
          const boxH = textLines.length * 14 + 8
          const boxX = Math.min(PAD.l + (segments.reduce((s, seg) => s + (bar.values[seg.key] || 0), 0) / maxVal) * innerW + 40, W - boxW - 8)
          return (
            <g>
              <rect x={boxX} y={y} width={boxW} height={boxH} rx={4}
                fill="rgba(0,0,0,0.85)" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={0.5} />
              {textLines.map((line, li) => (
                <text key={li} x={boxX + 8} y={y + 14 + li * 14}
                  fontSize={10} fill="#fff" fontFamily="system-ui">{line}</text>
              ))}
            </g>
          )
        })()}
      </svg>
    )
  }

  const barW = Math.min(40, (innerW / bars.length) - 6)
  const gap = (innerW - barW * bars.length) / (bars.length + 1)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const yv = PAD.t + innerH - f * innerH
        return (
          <g key={f}>
            <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv}
              stroke="rgba(var(--kt-ink-rgb), 0.05)" strokeWidth={0.5} />
            <text x={PAD.l - 4} y={yv + 3} textAnchor="end"
              fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)" fontFamily="system-ui">
              {Math.round(maxVal * f)}
            </text>
          </g>
        )
      })}

      {bars.map((bar, i) => {
        const x = PAD.l + gap + i * (barW + gap)
        let yOffset = PAD.t + innerH
        const isHov = hover === i
        return (
          <g key={bar.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          >
            {segments.map(seg => {
              const val = bar.values[seg.key] || 0
              const h = (val / maxVal) * innerH
              yOffset -= h
              return (
                <rect key={seg.key}
                  x={x} y={yOffset} width={barW} height={h} rx={2}
                  fill={isHov ? seg.color : seg.color + 'bb'}
                />
              )
            })}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle"
              fontSize={9} fill={isHov ? 'var(--kt-ink)' : 'rgba(var(--kt-ink-rgb), 0.3)'} fontFamily="system-ui">
              {bar.label.length > 8 ? bar.label.slice(0, 6) + '..' : bar.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
