import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, TrendingUp, Activity, Flame, Download, Crosshair } from 'lucide-react'
import { getProjects, getCycles, getAnalyticsOverview, getAnalyticsHeatmap, getAnalyticsBurndown, getAnalyticsVelocity, getAnalyticsStatusTrend, getEstimationCalibration } from '../api/client'
import { BRAND, STATUS_COLOR } from '../constants/theme'

// ——— Tooltip component ———
function SvgTooltip({ x, y, text, svgWidth }) {
  if (!text) return null
  const lines = text.split('\n')
  const lineH = 14
  const padX = 8, padY = 6
  const charW = 6.5
  const maxLen = Math.max(...lines.map(l => l.length))
  const boxW = maxLen * charW + padX * 2
  const boxH = lines.length * lineH + padY * 2
  // Flip horizontally if too close to right edge
  const adjustedX = (x + boxW + 8 > svgWidth) ? x - boxW - 8 : x + 8
  const adjustedY = Math.max(2, y - boxH / 2)

  return (
    <g>
      <rect x={adjustedX} y={adjustedY} width={boxW} height={boxH} rx={4}
        fill="rgba(0,0,0,0.85)" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={0.5} />
      {lines.map((line, i) => (
        <text key={i} x={adjustedX + padX} y={adjustedY + padY + (i + 1) * lineH - 3}
          fontSize={11} fill="#fff" fontFamily="system-ui">{line}</text>
      ))}
    </g>
  )
}

// ——— Heatmap ———
function Heatmap({ data }) {
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

// ——— Burndown Chart ———
function BurndownChart({ data }) {
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

// ——— Velocity Chart ———
function VelocityChart({ data }) {
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
              fill={isHovered ? 'rgba(250,204,21,0.7)' : 'rgba(250,204,21,0.5)'}
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

// ——— Status Trend ———
function StatusTrendChart({ data }) {
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
          <text x={PAD.l + i * 80 + 14} y={H - 16} fontSize={9} fill="rgba(var(--kt-ink-rgb), 0.3)">{s}</text>
        </g>
      ))}
    </svg>
  )
}

function StatCard({ icon, label, value, sub, color, delay }) {
  return (
    <div className="kt-card" style={{
      padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6,
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: delay != null ? `${delay}s` : '0s',
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(var(--kt-ink-rgb), 0.4)', fontSize: 12 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--kt-ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, icon, children, delay, summary, actions }) {
  return (
    <div className="kt-panel" style={{
      padding: '20px 24px',
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: delay != null ? `${delay}s` : '0s',
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(var(--kt-ink-rgb), 0.6)', fontSize: 13, fontWeight: 600 }}>
          {icon}{title}
        </div>
        {actions && <div style={{ display: 'flex', gap: 6 }}>{actions}</div>}
      </div>
      {children}
      {summary && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.3)', fontStyle: 'italic' }}>
          {summary}
        </div>
      )}
    </div>
  )
}

// ——— Estimation calibration ———
function ratioColor(ratio) {
  if (ratio == null) return 'rgba(var(--kt-ink-rgb), 0.15)'
  if (ratio > 1.2) return STATUS_COLOR.failed
  if (ratio < 0.8) return STATUS_COLOR.in_progress
  return STATUS_COLOR.done
}

function CalibrationChart({ data }) {
  const { t } = useTranslation()

  if (!data || data.sample_size === 0) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.calibrationEmpty')}</div>
  }

  const buckets = data.buckets.filter(b => b.count > 0)
  const maxRatio = Math.max(2, ...buckets.map(b => b.avg_ratio || 0))
  const W = 560
  const labelW = 64
  const countW = 40
  const barMax = W - labelW - countW - 60
  const rowH = 26

  const scale = (ratio) => (ratio / maxRatio) * barMax
  const refX = labelW + scale(1)

  return (
    <div>
      <svg width="100%" height={buckets.length * rowH + 26} viewBox={`0 0 ${W} ${buckets.length * rowH + 26}`} style={{ maxWidth: W }}>
        {/* reference line at ratio 1.0 (perfect estimate) */}
        <line x1={refX} y1={0} x2={refX} y2={buckets.length * rowH} stroke="rgba(var(--kt-ink-rgb), 0.25)" strokeDasharray="3 3" />
        <text x={refX} y={buckets.length * rowH + 14} fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.3)" textAnchor="middle">1.0×</text>
        <text x={W} y={buckets.length * rowH + 14} fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.2)" textAnchor="end">{t('analytics.calibrationAxis')}</text>

        {buckets.map((b, i) => {
          const y = i * rowH
          const color = ratioColor(b.avg_ratio)
          return (
            <g key={b.label}>
              <text x={labelW - 8} y={y + rowH / 2 + 4} fontSize={11} fill="rgba(var(--kt-ink-rgb), 0.5)" textAnchor="end">{b.label}</text>
              <rect x={labelW} y={y + 6} width={scale(b.avg_ratio)} height={rowH - 12} rx={3} fill={color} opacity={0.75} />
              <text x={labelW + scale(b.avg_ratio) + 6} y={y + rowH / 2 + 4} fontSize={11} fill={color} fontWeight={700}>
                {b.avg_ratio}×
              </text>
              <text x={W} y={y + rowH / 2 + 4} fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.25)" textAnchor="end">n={b.count}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.4)' }}>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR.failed, marginRight: 5 }} />{data.underestimated} {t('analytics.calibrationUnder')}</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR.done, marginRight: 5 }} />{data.sample_size - data.underestimated - data.overestimated} {t('analytics.calibrationOnTarget')}</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR.in_progress, marginRight: 5 }} />{data.overestimated} {t('analytics.calibrationOver')}</span>
      </div>
    </div>
  )
}

function ExportButton({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="kt-btn"
      style={{ padding: '4px 10px', fontSize: 11 }}
    >
      <Download size={11} />
      {label}
    </button>
  )
}

function downloadCsv(filename, headers, rows) {
  const escape = (val) => {
    const s = String(val == null ? '' : val)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Analytics() {
  const { t } = useTranslation()
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [trendDays, setTrendDays] = useState(30)

  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: getAnalyticsOverview, staleTime: 60000 })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects, staleTime: 30000 })
  const { data: cycles = [] } = useQuery({
    queryKey: ['cycles-all', selectedProjectId],
    queryFn: () => getCycles(selectedProjectId),
    enabled: !!selectedProjectId,
  })
  const { data: heatmap = [] } = useQuery({ queryKey: ['analytics-heatmap', selectedProjectId], queryFn: () => getAnalyticsHeatmap(selectedProjectId ? { project_id: selectedProjectId } : {}), staleTime: 60000 })
  const { data: burndown = [] } = useQuery({ queryKey: ['analytics-burndown', selectedCycleId], queryFn: () => getAnalyticsBurndown(selectedCycleId), enabled: !!selectedCycleId, staleTime: 30000 })
  const { data: velocity = [] } = useQuery({ queryKey: ['analytics-velocity', selectedProjectId], queryFn: () => getAnalyticsVelocity(selectedProjectId), enabled: !!selectedProjectId, staleTime: 30000 })
  const { data: trend = [] } = useQuery({ queryKey: ['analytics-trend', selectedProjectId, trendDays], queryFn: () => getAnalyticsStatusTrend(selectedProjectId || undefined, trendDays), staleTime: 30000 })
  const { data: calibration } = useQuery({ queryKey: ['analytics-calibration', selectedProjectId], queryFn: () => getEstimationCalibration(selectedProjectId ? { project_id: selectedProjectId } : {}), staleTime: 60000 })

  const exportHeatmap = useCallback(() => {
    if (heatmap.length === 0) return
    downloadCsv('heatmap.csv', ['Date', 'Count'], heatmap.map(d => [d.date, d.count]))
  }, [heatmap])

  const exportBurndown = useCallback(() => {
    if (burndown.length === 0) return
    downloadCsv('burndown.csv', ['Date', 'Remaining', 'Done'], burndown.map(d => [d.date, d.remaining, d.done]))
  }, [burndown])

  const exportVelocity = useCallback(() => {
    if (velocity.length === 0) return
    downloadCsv('velocity.csv', ['Cycle', 'Total', 'Completed'], velocity.map(d => [d.name, d.total_tasks, d.completed_tasks]))
  }, [velocity])

  const exportTrend = useCallback(() => {
    if (trend.length === 0) return
    downloadCsv('status-trend.csv', ['Date', 'Todo', 'In Progress', 'Done', 'Failed'], trend.map(d => [d.date, d.todo, d.in_progress, d.done, d.failed]))
  }, [trend])

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('analytics.title')}</h1>
          <p className="kt-page-subtitle">{t('analytics.subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setSelectedCycleId('') }} className="kt-input" style={{ width: 'auto', cursor: 'pointer' }}>
          <option value="">{t('analytics.allProjects')}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {selectedProjectId && cycles.length > 0 && (
          <select value={selectedCycleId} onChange={e => setSelectedCycleId(e.target.value)} className="kt-input" style={{ width: 'auto', cursor: 'pointer' }}>
            <option value="">{t('analytics.selectCycle')}</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select value={trendDays} onChange={e => setTrendDays(Number(e.target.value))} className="kt-input" style={{ width: 'auto', cursor: 'pointer' }}>
          <option value={7}>{t('analytics.last7Days')}</option>
          <option value={30}>{t('analytics.last30Days')}</option>
          <option value={90}>{t('analytics.last90Days')}</option>
        </select>
      </div>

      {/* Overview cards */}
      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard icon={<BarChart2 size={13}/>} label={t('analytics.totalTasks')} value={overview.total_tasks} delay={0} />
          <StatCard icon={<Activity size={13}/>} label={t('analytics.done')} value={overview.done_tasks} color={STATUS_COLOR.done} delay={0.08} />
          <StatCard icon={<TrendingUp size={13}/>} label={t('analytics.inProgress')} value={overview.in_progress_tasks} color={STATUS_COLOR.in_progress} delay={0.16} />
          <StatCard icon={<Flame size={13}/>} label={t('analytics.overdueCount')} value={overview.overdue_tasks} color={overview.overdue_tasks > 0 ? STATUS_COLOR.failed : STATUS_COLOR.todo} delay={0.24} />
          {overview.most_active_project && (
            <StatCard
              icon={<Activity size={13}/>}
              label={t('analytics.mostActive')}
              value={overview.most_active_project.name}
              sub={t('analytics.eventsThisWeek', { count: overview.most_active_project.activity_count })}
              color="var(--kt-hit)"
              delay={0.32}
            />
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Activity Heatmap */}
        {(() => {
          const mostActive = heatmap.length > 0
            ? heatmap.reduce((best, d) => d.count > best.count ? d : best, heatmap[0])
            : null
          const heatmapSummary = mostActive && mostActive.count > 0
            ? t('analytics.mostActiveDay', { date: mostActive.date, count: mostActive.count })
            : null
          return (
            <Section title={t('analytics.heatmap')} icon={<Activity size={13}/>} delay={0.05} summary={heatmapSummary}
              actions={heatmap.length > 0 && <ExportButton onClick={exportHeatmap} label="CSV" />}
            >
              <Heatmap data={heatmap} />
            </Section>
          )
        })()}

        {/* Burndown */}
        {selectedProjectId && (() => {
          let burndownSummary = null
          if (selectedCycleId && burndown.length > 1) {
            const last = burndown[burndown.length - 1]
            const total = (burndown[0]?.remaining || 0) + (burndown[0]?.done || 0)
            const idealRemaining = total - (total / (burndown.length - 1)) * (burndown.length - 1)
            const diff = Math.round(last.remaining - idealRemaining)
            if (diff < -1) burndownSummary = t('analytics.burndownAhead', { count: Math.abs(diff) })
            else if (diff > 1) burndownSummary = t('analytics.burndownBehind', { count: diff })
            else burndownSummary = t('analytics.burndownOnTrack')
          }
          return (
            <Section title={t('analytics.cycleBurndown')} icon={<TrendingUp size={13}/>} delay={0.13} summary={burndownSummary}
              actions={selectedCycleId && burndown.length > 0 && <ExportButton onClick={exportBurndown} label="CSV" />}
            >
              {!selectedCycleId ? (
                <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13 }}>{t('analytics.selectCycleForBurndown')}</div>
              ) : (
                <BurndownChart data={burndown} />
              )}
            </Section>
          )
        })()}

        {/* Velocity */}
        {selectedProjectId && (() => {
          let velocitySummary = null
          if (velocity.length > 0) {
            const avg = Math.round(velocity.reduce((sum, d) => sum + d.completed_tasks, 0) / velocity.length)
            velocitySummary = t('analytics.velocityAvg', { count: avg })
          }
          return (
            <Section title={t('analytics.velocity')} icon={<BarChart2 size={13}/>} delay={0.21} summary={velocitySummary}
              actions={velocity.length > 0 && <ExportButton onClick={exportVelocity} label="CSV" />}
            >
              <VelocityChart data={velocity} />
            </Section>
          )
        })()}

        {/* Status Trend */}
        <Section title={t('analytics.statusTrend', { days: trendDays })} icon={<TrendingUp size={13}/>} delay={0.29}
          actions={trend.length > 0 && <ExportButton onClick={exportTrend} label="CSV" />}
        >
          <StatusTrendChart data={trend} />
        </Section>

        {/* Estimation calibration */}
        {(() => {
          const calibrationSummary = calibration && calibration.sample_size > 0
            ? `${t('analytics.calibrationSummary', { ratio: calibration.overall_ratio, within: calibration.within_20_pct })} · ${t('analytics.calibrationSample', { count: calibration.sample_size })}`
            : null
          return (
            <Section title={t('analytics.calibration')} icon={<Crosshair size={13}/>} delay={0.37} summary={calibrationSummary}>
              <CalibrationChart data={calibration} />
            </Section>
          )
        })()}
      </div>
    </div>
  )
}
