import { useState } from 'react'

export default function TrendLineChart({ series = [], height = 200, showArea = false, showLegend = true }) {
  const [hoverX, setHoverX] = useState(null)
  const W = 600
  const H = height
  const PAD = { t: 16, r: 20, b: 28, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  if (series.length === 0 || series.every(s => s.data.length === 0)) {
    return (
      <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
        No activity data
      </div>
    )
  }

  const allDates = [...new Set(series.flatMap(s => s.data.map(d => d.date)))].sort()
  const maxVal = Math.max(...series.flatMap(s => s.data.map(d => d.value)), 1)
  const dateCount = allDates.length

  const x = (dateStr) => {
    const idx = allDates.indexOf(dateStr)
    return PAD.l + (dateCount > 1 ? (idx / (dateCount - 1)) * innerW : innerW / 2)
  }
  const y = (val) => PAD.t + innerH - (val / maxVal) * innerH

  const hoverIdx = hoverX !== null
    ? Math.round(((hoverX - PAD.l) / innerW) * (dateCount - 1))
    : null
  const hoverDate = hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dateCount
    ? allDates[hoverIdx]
    : null

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const yv = PAD.t + innerH - f * innerH
          return (
            <g key={f}>
              <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv}
                stroke="rgba(var(--kt-ink-rgb), 0.05)" strokeWidth={1} />
              <text x={PAD.l - 4} y={yv + 4} textAnchor="end"
                fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)" fontFamily="system-ui">
                {Math.round(maxVal * f)}
              </text>
            </g>
          )
        })}

        {series.map((s, si) => {
          if (s.data.length === 0) return null
          const sorted = [...s.data].sort((a, b) => a.date.localeCompare(b.date))
          const points = sorted.map(d => `${x(d.date)},${y(d.value)}`).join(' ')

          return (
            <g key={si}>
              {showArea && (
                <polygon
                  points={`${x(sorted[0].date)},${y(0)} ${points} ${x(sorted[sorted.length - 1].date)},${y(0)}`}
                  fill={s.color + '18'}
                />
              )}
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={1.5}
                strokeLinejoin="round" strokeLinecap="round" />
            </g>
          )
        })}

        {hoverDate && (
          <g>
            <line x1={x(hoverDate)} y1={PAD.t} x2={x(hoverDate)} y2={PAD.t + innerH}
              stroke="rgba(var(--kt-ink-rgb), 0.2)" strokeWidth={1} strokeDasharray="3 2" />
            {series.map((s, si) => {
              const point = s.data.find(d => d.date === hoverDate)
              if (!point) return null
              return (
                <circle key={si} cx={x(hoverDate)} cy={y(point.value)} r={3.5}
                  fill={s.color} stroke="#000" strokeWidth={1} />
              )
            })}
            <rect x={x(hoverDate) - 36} y={PAD.t - 14} width={72} height={14} rx={3}
              fill="rgba(0,0,0,0.8)" />
            <text x={x(hoverDate)} y={PAD.t - 4} textAnchor="middle"
              fontSize={9} fill="#fff" fontFamily="system-ui">
              {hoverDate.slice(5)}
            </text>
          </g>
        )}

        <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH}
          fill="transparent" style={{ cursor: 'crosshair' }}
          onMouseMove={e => {
            const rect = e.currentTarget.closest('svg').getBoundingClientRect()
            const svgX = (e.clientX - rect.left) / rect.width * W
            setHoverX(svgX)
          }}
          onMouseLeave={() => setHoverX(null)}
        />

        {allDates.filter((_, i) => i % Math.max(1, Math.ceil(dateCount / 8)) === 0 || i === dateCount - 1).map(d => (
          <text key={d} x={x(d)} y={H - 4} textAnchor="middle"
            fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)" fontFamily="system-ui">
            {d.slice(5)}
          </text>
        ))}
      </svg>

      {showLegend && series.length > 1 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
          {series.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <span style={{ width: 12, height: 3, background: s.color, borderRadius: 2 }} />
              <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.5)' }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
