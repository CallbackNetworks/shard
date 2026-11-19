import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, TrendingUp, Activity, Flame, Download, Crosshair } from 'lucide-react'
import { getProjects, getCycles, getAnalyticsOverview, getAnalyticsHeatmap, getAnalyticsBurndown, getAnalyticsVelocity, getAnalyticsStatusTrend, getEstimationCalibration } from '../api/client'
import { qk } from '../api/queryKeys'
import { STATUS_COLOR } from '../constants/theme'
import ActivityHeatmap from '../components/charts/ActivityHeatmap'
import StatCard from '../components/charts/StatCard'
import BurndownChart from '../components/charts/BurndownChart'
import VelocityChart from '../components/charts/VelocityChart'
import StatusTrendChart from '../components/charts/StatusTrendChart'

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

  const { data: overview } = useQuery({ queryKey: qk.analyticsOverview(), queryFn: getAnalyticsOverview, staleTime: 60000 })
  const { data: projects = [] } = useQuery({ queryKey: qk.projects(), queryFn: getProjects, staleTime: 30000 })
  const { data: cycles = [] } = useQuery({
    queryKey: qk.cyclesAll(selectedProjectId),
    queryFn: () => getCycles(selectedProjectId),
    enabled: !!selectedProjectId,
  })
  const { data: heatmap = [] } = useQuery({ queryKey: qk.analyticsHeatmap(selectedProjectId), queryFn: () => getAnalyticsHeatmap(selectedProjectId ? { project_id: selectedProjectId } : {}), staleTime: 60000 })
  const { data: burndown = [] } = useQuery({ queryKey: qk.analyticsBurndown(selectedCycleId), queryFn: () => getAnalyticsBurndown(selectedCycleId), enabled: !!selectedCycleId, staleTime: 30000 })
  const { data: velocity = [] } = useQuery({ queryKey: qk.analyticsVelocity(selectedProjectId), queryFn: () => getAnalyticsVelocity(selectedProjectId), enabled: !!selectedProjectId, staleTime: 30000 })
  const { data: trend = [] } = useQuery({ queryKey: qk.analyticsTrend(selectedProjectId, trendDays), queryFn: () => getAnalyticsStatusTrend(selectedProjectId || undefined, trendDays), staleTime: 30000 })
  const { data: calibration } = useQuery({ queryKey: qk.analyticsCalibration(selectedProjectId), queryFn: () => getEstimationCalibration(selectedProjectId ? { project_id: selectedProjectId } : {}), staleTime: 60000 })

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
      <div data-tour="analytics-filters" style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
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
        <div data-tour="analytics-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
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

      <div data-tour="analytics-charts" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
              <ActivityHeatmap data={heatmap} />
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
