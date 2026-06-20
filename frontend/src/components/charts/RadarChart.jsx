import { useState } from 'react'

export default function RadarChart({ axes = [], datasets = [], size = 240 }) {
  const [hover, setHover] = useState(null)
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 30
  const angleStep = (2 * Math.PI) / axes.length

  if (axes.length < 3) return null

  const getPoint = (axisIdx, value) => {
    const angle = axisIdx * angleStep - Math.PI / 2
    const r = (value / 100) * radius
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }

  const gridLevels = [0.25, 0.5, 0.75, 1]

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {gridLevels.map(level => {
        const points = axes.map((_, i) => {
          const p = getPoint(i, level * 100)
          return `${p.x},${p.y}`
        }).join(' ')
        return (
          <polygon key={level} points={points} fill="none"
            stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        )
      })}

      {axes.map((_, i) => {
        const p = getPoint(i, 100)
        return (
          <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y}
            stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        )
      })}

      {datasets.map((ds, di) => {
        const points = axes.map((_, i) => {
          const p = getPoint(i, ds.values[i] || 0)
          return `${p.x},${p.y}`
        }).join(' ')
        const isHovered = hover === di
        return (
          <g key={di}
            onMouseEnter={() => setHover(di)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          >
            <polygon points={points}
              fill={ds.color + (isHovered ? '30' : '18')}
              stroke={ds.color}
              strokeWidth={isHovered ? 2 : 1.5}
              strokeLinejoin="round"
            />
            {axes.map((_, i) => {
              const p = getPoint(i, ds.values[i] || 0)
              return (
                <circle key={i} cx={p.x} cy={p.y}
                  r={isHovered ? 3.5 : 2.5}
                  fill={ds.color} stroke="#000" strokeWidth={0.5}
                />
              )
            })}
          </g>
        )
      })}

      {axes.map((axis, i) => {
        const p = getPoint(i, 115)
        return (
          <text key={i} x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill="rgba(255,255,255,0.45)" fontFamily="system-ui">
            {axis.label}
          </text>
        )
      })}

      {hover !== null && datasets[hover] && (
        <g>
          <rect x={cx - 50} y={size - 22} width={100} height={18} rx={4}
            fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
          <text x={cx} y={size - 10} textAnchor="middle" fontSize={10}
            fill={datasets[hover].color} fontFamily="system-ui" fontWeight={700}>
            {datasets[hover].name}
          </text>
        </g>
      )}
    </svg>
  )
}
