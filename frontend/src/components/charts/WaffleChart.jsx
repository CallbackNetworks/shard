import { useState } from 'react'
import { alpha } from '../../utils/color'

export default function WaffleChart({ segments = [], total, cols = 10, cellSize = 14, gap = 2 }) {
  const [hover, setHover] = useState(null)

  const actualTotal = total || segments.reduce((s, seg) => s + seg.value, 0)
  if (actualTotal === 0) return null

  const cells = []
  for (const seg of segments) {
    const count = Math.round((seg.value / actualTotal) * actualTotal)
    for (let i = 0; i < count && cells.length < actualTotal; i++) {
      cells.push({ color: seg.color, label: seg.label, segIdx: segments.indexOf(seg) })
    }
  }
  while (cells.length < actualTotal) {
    cells.push({ color: 'rgba(var(--kt-ink-rgb), 0.06)', label: 'Empty', segIdx: -1 })
  }

  const rows = Math.ceil(cells.length / cols)
  const width = cols * (cellSize + gap) - gap
  const height = rows * (cellSize + gap) - gap

  return (
    <div>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {cells.map((cell, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const isHov = hover === cell.segIdx && cell.segIdx >= 0
          return (
            <rect
              key={i}
              x={col * (cellSize + gap)}
              y={row * (cellSize + gap)}
              width={cellSize} height={cellSize} rx={2}
              fill={isHov || cell.segIdx < 0 ? cell.color : alpha(cell.color, 80)}
              stroke={isHov ? 'var(--kt-ink)' : 'none'} strokeWidth={isHov ? 0.5 : 0}
              onMouseEnter={() => setHover(cell.segIdx)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: cell.segIdx >= 0 ? 'pointer' : 'default', transition: 'fill 0.12s' }}
            />
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        {segments.filter(s => s.value > 0).map((seg, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
            opacity: hover !== null && hover !== i ? 0.4 : 1,
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.5)' }}>{seg.label}</span>
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontWeight: 700 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
