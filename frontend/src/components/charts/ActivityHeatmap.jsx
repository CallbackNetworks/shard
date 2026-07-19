import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SvgTooltip from './SvgTooltip'

/** GitHub-style 53-week activity heatmap (named to avoid clashing with HeatmapChart). */
export default function ActivityHeatmap({ data }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState(null)

  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.noActivityYet')}</div>
  }

  const countByDate = {}
  data.forEach(d => { countByDate[d.date] = d.count })
  const maxCount = Math.max(...data.map(d => d.count), 1)

  const today = new Date()
  const weeks = []
  let start = new Date(today)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay())

  for (let w = 0; w < 53; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start)
      dt.setDate(start.getDate() + w * 7 + d)
      const key = dt.toISOString().split('T')[0]
      week.push({ date: key, count: countByDate[key] || 0 })
    }
    weeks.push(week)
  }

  // Build month labels
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

  const cellSize = 10
  const gap = 2
  const labelH = 16
  const totalW = weeks.length * (cellSize + gap)
  const totalH = 7 * (cellSize + gap) + labelH

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={totalH + 16} style={{ display: 'block' }}>
        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text key={i} x={m.weekIndex * (cellSize + gap)} y={10}
            fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.3)" fontFamily="system-ui">
            {m.label}
          </text>
        ))}
        {/* Cells */}
        {weeks.map((week, wi) =>
          week.map((cell, di) => {
            const intensity = cell.count === 0 ? 0 : 0.15 + (cell.count / maxCount) * 0.85
            const fill = cell.count === 0
              ? 'rgba(var(--kt-ink-rgb), 0.05)'
              : `rgba(250,204,21,${intensity})`
            const isHovered = hover && hover.date === cell.date
            return (
              <rect
                key={`${wi}-${di}`}
                x={wi * (cellSize + gap)}
                y={labelH + di * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
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
        {/* Hover tooltip */}
        {hover && hover.count > 0 && (() => {
          const wi = weeks.findIndex(w => w.some(c => c.date === hover.date))
          const di = wi >= 0 ? weeks[wi].findIndex(c => c.date === hover.date) : 0
          return (
            <SvgTooltip
              x={wi * (cellSize + gap) + cellSize}
              y={labelH + di * (cellSize + gap)}
              text={`${hover.date}\n${hover.count} ${hover.count === 1 ? 'activity' : 'activities'}`}
              svgWidth={totalW}
            />
          )
        })()}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.2)' }}>
        {t('analytics.less')}
        {[0.05, 0.2, 0.4, 0.65, 0.9].map((op, i) => (
          <span key={i} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: `rgba(250,204,21,${op})` }} />
        ))}
        {t('analytics.more')}
      </div>
    </div>
  )
}
