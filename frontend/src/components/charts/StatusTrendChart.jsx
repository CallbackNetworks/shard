import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STATUS_COLOR, STATUS_MAP } from '../../constants/theme'
import SvgTooltip from './SvgTooltip'

// ——— Status Trend ———
export default function StatusTrendChart({ data }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState(null)
  if (!data || data.length === 0) return null
  const W = 500, H = 160, PAD = { t: 10, r: 20, b: 30, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const statuses = ['done', 'in_progress', 'todo', 'failed']

  const maxTotal = Math.max(...data.map(d => d.done + d.in_progress + d.todo + d.failed), 1)

  const lineFor = (key) => data.map((d, i) => {
    const xv = PAD.l + (i / (data.length - 1)) * innerW
    const yv = PAD.t + innerH - (d[key] / maxTotal) * innerH
    return `${xv},${yv}`
  }).join(' ')

  const xAt = (i) => PAD.l + (i / (data.length - 1)) * innerW

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {[0, 0.5, 1].map(f => {
        const yv = PAD.t + innerH - f * innerH
        return (
          <g key={f}>
            <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv} stroke="rgba(var(--kt-ink-rgb), 0.05)" strokeWidth={1} />
            <text x={PAD.l - 4} y={yv + 4} textAnchor="end" fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">{Math.round(maxTotal * f)}</text>
          </g>
        )
      })}
      {statuses.map(s => (
        <polyline key={s} points={lineFor(s)} fill="none" stroke={STATUS_COLOR[s]} strokeWidth={1.5} strokeLinejoin="round" opacity={0.8} />
      ))}
      {/* Hover vertical line and circles */}
      {hover !== null && (
        <line x1={xAt(hover)} y1={PAD.t} x2={xAt(hover)} y2={PAD.t + innerH}
          stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={1} strokeDasharray="3 2" />
      )}
      {hover !== null && statuses.map(s => {
        const yv = PAD.t + innerH - (data[hover][s] / maxTotal) * innerH
        return <circle key={s} cx={xAt(hover)} cy={yv} r={3} fill={STATUS_COLOR[s]} />
      })}
      {/* Invisible hover areas */}
      {data.map((_, i) => (
        <rect key={i} x={xAt(i) - (innerW / data.length / 2)} y={PAD.t} width={innerW / data.length} height={innerH}
          fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
      ))}
      {hover !== null && (
        <SvgTooltip
          x={xAt(hover)}
          y={PAD.t + 10}
          text={`${data[hover].date}\nDone: ${data[hover].done}\nIn Progress: ${data[hover].in_progress}\nTodo: ${data[hover].todo}\nFailed: ${data[hover].failed}`}
          svgWidth={W}
        />
      )}
      {data.filter((_, i) => i % Math.ceil(data.length / 5) === 0).map((d) => {
        const i = data.indexOf(d)
        return (
          <text key={i} x={xAt(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.2)">
            {d.date.slice(5)}
          </text>
        )
      })}
      {statuses.map((s, i) => (
        <g key={s}>
          <rect x={PAD.l + i * 80} y={H - 22} width={10} height={4} rx={2} fill={STATUS_COLOR[s]} />
          <text x={PAD.l + i * 80 + 14} y={H - 16} fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.3)">
            {STATUS_MAP[s] ? t(STATUS_MAP[s].labelKey) : s}
          </text>
        </g>
      ))}
    </svg>
  )
}
