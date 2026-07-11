import { useState } from 'react'

export default function AreaChart({ layers = [], height = 200 }) {
  const [hoverX, setHoverX] = useState(null)
  const W = 600
  const H = height
  const PAD = { t: 16, r: 20, b: 28, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  if (layers.length === 0 || layers.every(l => l.data.length === 0)) {
    return (
      <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
        No data
      </div>
    )
  }

  const allDates = [...new Set(layers.flatMap(l => l.data.map(d => d.date)))].sort()
  const dateCount = allDates.length

  const stackedByDate = {}
  for (const date of allDates) {
    let cumulative = 0
    stackedByDate[date] = layers.map(layer => {
      const point = layer.data.find(d => d.date === date)
      const val = point ? point.value : 0
      cumulative += val
      return { bottom: cumulative - val, top: cumulative, value: val }
    })
  }

  const maxVal = Math.max(...allDates.map(d =>
    stackedByDate[d][stackedByDate[d].length - 1]?.top || 0
  ), 1)

  const x = (dateStr) => {
    const idx = allDates.indexOf(dateStr)
    return PAD.l + (dateCount > 1 ? (idx / (dateCount - 1)) * innerW : innerW / 2)
  }
  const y = (val) => PAD.t + innerH - (val / maxVal) * innerH

  const hoverIdx = hoverX !== null
    ? Math.round(((hoverX - PAD.l) / innerW) * (dateCount - 1))
    : null
  const hoverDate = hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dateCount
    ? allDates[hoverIdx] : null

  return (
    <div>
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

        {[...layers].reverse().map((layer, ri) => {
          const li = layers.length - 1 - ri
          const topPoints = allDates.map(d => `${x(d)},${y(stackedByDate[d][li].top)}`).join(' ')
          const bottomPoints = [...allDates].reverse().map(d => `${x(d)},${y(stackedByDate[d][li].bottom)}`).join(' ')
          return (
            <polygon key={li}
              points={`${topPoints} ${bottomPoints}`}
              fill={layer.color + '44'}
              stroke={layer.color}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          )
        })}

        {hoverDate && (
          <g>
            <line x1={x(hoverDate)} y1={PAD.t} x2={x(hoverDate)} y2={PAD.t + innerH}
              stroke="rgba(var(--kt-ink-rgb), 0.25)" strokeWidth={1} strokeDasharray="3 2" />
            {layers.map((layer, li) => {
              const pt = stackedByDate[hoverDate][li]
              return (
                <circle key={li} cx={x(hoverDate)} cy={y(pt.top)} r={3}
                  fill={layer.color} stroke="#000" strokeWidth={0.5} />
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
            setHoverX((e.clientX - rect.left) / rect.width * W)
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

      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {layers.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 12, height: 8, borderRadius: 2, background: l.color + '88' }} />
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.5)' }}>{l.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
