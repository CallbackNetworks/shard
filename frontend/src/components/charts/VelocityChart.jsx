import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SvgTooltip from './SvgTooltip'

// ——— Velocity Chart ———
export default function VelocityChart({ data }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState(null)

  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.completeOneCycle')}</div>
  }
  const barH = 28, gap = 8, padding = { l: 130, r: 40, t: 10, b: 10 }
  const maxVal = Math.max(...data.map(d => d.total_tasks), 1)
  const W = 500
  const H = data.length * (barH + gap) + padding.t + padding.b
  const innerW = W - padding.l - padding.r

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const y = padding.t + i * (barH + gap)
        const totalW = (d.total_tasks / maxVal) * innerW
        const doneW = (d.completed_tasks / maxVal) * innerW
        const isHovered = hover === i
        return (
          <g key={d.cycle_id}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          >
            <text x={padding.l - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize={11} fill="rgba(var(--kt-ink-rgb), 0.5)">
              {d.name.length > 18 ? d.name.slice(0, 16) + '\u2026' : d.name}
            </text>
            <rect x={padding.l} y={y} width={totalW} height={barH} rx={4}
              fill={isHovered ? 'rgba(var(--kt-ink-rgb), 0.1)' : 'rgba(var(--kt-ink-rgb), 0.06)'}
            />
            <rect x={padding.l} y={y} width={doneW} height={barH} rx={4}
              fill={isHovered ? 'color-mix(in srgb, var(--kt-hit) 70%, transparent)' : 'color-mix(in srgb, var(--kt-hit) 50%, transparent)'}
            />
            <text x={padding.l + totalW + 6} y={y + barH / 2 + 4} fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.3)">
              {d.completed_tasks}/{d.total_tasks}
            </text>
          </g>
        )
      })}
      {hover !== null && (() => {
        const d = data[hover]
        const y = padding.t + hover * (barH + gap)
        const rate = d.total_tasks > 0 ? Math.round((d.completed_tasks / d.total_tasks) * 100) : 0
        return (
          <SvgTooltip
            x={padding.l + (d.total_tasks / maxVal) * innerW + 40}
            y={y}
            text={`${d.name}\nCompleted: ${d.completed_tasks}/${d.total_tasks} (${rate}%)`}
            svgWidth={W}
          />
        )
      })()}
    </svg>
  )
}
