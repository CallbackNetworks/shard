import { useState } from 'react'

export default function HeatmapChart({ data = [], color = '#facc15', cellSize = 10, days = 365 }) {
  const [hover, setHover] = useState(null)

  const countByDate = {}
  data.forEach(d => { countByDate[d.date] = d.count })
  const maxCount = Math.max(...data.map(d => d.count), 1)

  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  start.setDate(start.getDate() - start.getDay())

  const gap = 2
  const numWeeks = Math.ceil(days / 7) + 1
  const labelH = 16
  const totalW = numWeeks * (cellSize + gap)
  const totalH = 7 * (cellSize + gap) + labelH

  const weeks = []
  for (let w = 0; w < numWeeks; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start)
      dt.setDate(start.getDate() + w * 7 + d)
      const key = dt.toISOString().split('T')[0]
      week.push({ date: key, count: countByDate[key] || 0 })
    }
    weeks.push(week)
  }

  const monthLabels = []
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  let lastMonth = -1
  for (let w = 0; w < weeks.length; w++) {
    const firstDay = new Date(weeks[w][0].date)
    const month = firstDay.getMonth()
    if (month !== lastMonth) {
      monthLabels.push({ weekIndex: w, label: monthNames[month] })
      lastMonth = month
    }
  }

  const hexToRgb = (hex) => {
    const h = hex.replace('#', '')
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)]
  }

  const [r, g, b] = hexToRgb(color)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={totalH + 16} style={{ display: 'block' }}>
        {monthLabels.map((m, i) => (
          <text key={i} x={m.weekIndex * (cellSize + gap)} y={10}
            fontSize={9} fill="rgba(255,255,255,0.3)" fontFamily="system-ui">
            {m.label}
          </text>
        ))}
        {weeks.map((week, wi) =>
          week.map((cell, di) => {
            const intensity = cell.count === 0 ? 0 : 0.15 + (cell.count / maxCount) * 0.85
            const fill = cell.count === 0
              ? 'rgba(255,255,255,0.05)'
              : `rgba(${r},${g},${b},${intensity})`
            const isHovered = hover && hover.date === cell.date
            return (
              <rect
                key={`${wi}-${di}`}
                x={wi * (cellSize + gap)}
                y={labelH + di * (cellSize + gap)}
                width={cellSize} height={cellSize} rx={2}
                fill={fill}
                stroke={isHovered ? '#fff' : 'none'}
                strokeWidth={isHovered ? 1 : 0}
                style={{ cursor: cell.count > 0 ? 'pointer' : 'default' }}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })
        )}
        {hover && hover.count > 0 && (() => {
          const wi = weeks.findIndex(w => w.some(c => c.date === hover.date))
          const di = wi >= 0 ? weeks[wi].findIndex(c => c.date === hover.date) : 0
          const tx = wi * (cellSize + gap) + cellSize + 8
          const ty = labelH + di * (cellSize + gap)
          const text = `${hover.date}: ${hover.count}`
          const boxW = text.length * 6.5 + 16
          const adjustedX = tx + boxW > totalW ? tx - boxW - 16 : tx
          return (
            <g>
              <rect x={adjustedX} y={ty - 4} width={boxW} height={20} rx={4}
                fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
              <text x={adjustedX + 8} y={ty + 10} fontSize={10} fill="#fff" fontFamily="system-ui">{text}</text>
            </g>
          )
        })()}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        Less
        {[0.05, 0.2, 0.4, 0.65, 0.9].map((op, i) => (
          <span key={i} style={{
            display: 'inline-block', width: cellSize, height: cellSize, borderRadius: 2,
            background: `rgba(${r},${g},${b},${op})`,
          }} />
        ))}
        More
      </div>
    </div>
  )
}
