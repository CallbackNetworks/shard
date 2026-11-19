import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BRAND } from '../../constants/theme'
import SvgTooltip from './SvgTooltip'

// ——— Burndown Chart ———
export default function BurndownChart({ data }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState(null)

  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.noDataForCycle')}</div>
  }
  const W = 500, H = 200, PAD = { t: 10, r: 20, b: 30, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const maxVal = Math.max(...data.map(d => d.remaining), 1)

  const x = (i) => PAD.l + (i / (data.length - 1)) * innerW
  const y = (v) => PAD.t + innerH - (v / maxVal) * innerH

  const total = data[0]?.remaining + data[0]?.done || 1
  const idealPoints = data.map((_, i) => {
    const ideal = total - (total / (data.length - 1)) * i
    return `${x(i)},${y(ideal)}`
  }).join(' ')

  const actualPoints = data.map((d, i) => `${x(i)},${y(d.remaining)}`).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const yv = PAD.t + innerH - f * innerH
        return (
          <g key={f}>
            <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv} stroke="rgba(var(--kt-ink-rgb), 0.05)" strokeWidth={1} />
            <text x={PAD.l - 4} y={yv + 4} textAnchor="end" fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">
              {Math.round(maxVal * f)}
            </text>
          </g>
        )
      })}
      <polyline points={idealPoints} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={actualPoints} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" />
      {/* Interactive hover circles */}
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.remaining)} r={hover === i ? 4 : 12}
          fill={hover === i ? BRAND : 'transparent'} stroke="none"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
      {hover !== null && (
        <SvgTooltip
          x={x(hover)}
          y={y(data[hover].remaining)}
          text={`${data[hover].date}\nRemaining: ${data[hover].remaining}\nDone: ${data[hover].done}`}
          svgWidth={W}
        />
      )}
      {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1).map((d) => {
        const i = data.indexOf(d)
        return (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">
            {d.date.slice(5)}
          </text>
        )
      })}
      <line x1={PAD.l} y1={H - 18} x2={PAD.l + 16} y2={H - 18} stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeDasharray="4 3" strokeWidth={1} />
      <text x={PAD.l + 20} y={H - 14} fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">{t('analytics.ideal')}</text>
      <line x1={PAD.l + 55} y1={H - 18} x2={PAD.l + 71} y2={H - 18} stroke={BRAND} strokeWidth={2} />
      <text x={PAD.l + 75} y={H - 14} fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">{t('analytics.actual')}</text>
    </svg>
  )
}
