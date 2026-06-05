import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, TrendingUp, Activity, Flame } from 'lucide-react'
import { getProjects, getCycles } from '../api/client'
import useBreakpoint from '../hooks/useBreakpoint'
import axios from 'axios'

const _api = axios.create({ baseURL: '' })
_api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('auth_token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

const getOverview = () => _api.get('/analytics/overview').then(r => r.data)
const getHeatmap = (params) => _api.get('/analytics/heatmap', { params }).then(r => r.data)
const getBurndown = (cycleId) => _api.get('/analytics/burndown', { params: { cycle_id: cycleId } }).then(r => r.data)
const getVelocity = (projectId) => _api.get('/analytics/velocity', { params: { project_id: projectId } }).then(r => r.data)
const getStatusTrend = (projectId, days) => _api.get('/analytics/status-trend', { params: { project_id: projectId, days } }).then(r => r.data)

const BRAND = '#1ed760'
const STATUS_COLORS = { done: '#22c55e', in_progress: '#3b82f6', todo: '#94a3b8', failed: '#ef4444' }

// ——— Heatmap ———
function Heatmap({ data }) {
  const { t } = useTranslation()
  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.noActivityYet')}</div>
  }

  // Build 53-week × 7-day grid
  const countByDate = {}
  data.forEach(d => { countByDate[d.date] = d.count })
  const maxCount = Math.max(...data.map(d => d.count), 1)

  const today = new Date()
  const weeks = []
  // Start from 52 weeks ago, on a Sunday
  let start = new Date(today)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay()) // align to Sunday

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

  const cellSize = 10
  const gap = 2
  const totalW = weeks.length * (cellSize + gap)
  const totalH = 7 * (cellSize + gap)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={totalH + 16} style={{ display: 'block' }}>
        {weeks.map((week, wi) =>
          week.map((cell, di) => {
            const intensity = cell.count === 0 ? 0 : 0.15 + (cell.count / maxCount) * 0.85
            const fill = cell.count === 0
              ? 'rgba(255,255,255,0.05)'
              : `rgba(129,140,248,${intensity})`
            return (
              <rect
                key={`${wi}-${di}`}
                x={wi * (cellSize + gap)}
                y={di * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={fill}
                style={{ cursor: cell.count > 0 ? 'pointer' : 'default' }}
              >
                {cell.count > 0 && <title>{cell.date}: {cell.count} activities</title>}
              </rect>
            )
          })
        )}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        {t('analytics.less')}
        {[0.05, 0.2, 0.4, 0.65, 0.9].map((op, i) => (
          <span key={i} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: `rgba(129,140,248,${op})` }} />
        ))}
        {t('analytics.more')}
      </div>
    </div>
  )
}

// ——— Burndown Chart ———
function BurndownChart({ data }) {
  const { t } = useTranslation()
  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.noDataForCycle')}</div>
  }
  const W = 500, H = 200, PAD = { t: 10, r: 20, b: 30, l: 40 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const maxVal = Math.max(...data.map(d => d.remaining), 1)

  const x = (i) => PAD.l + (i / (data.length - 1)) * innerW
  const y = (v) => PAD.t + innerH - (v / maxVal) * innerH

  // Ideal line: linear from total to 0
  const total = data[0]?.remaining + data[0]?.done || 1
  const idealPoints = data.map((_, i) => {
    const ideal = total - (total / (data.length - 1)) * i
    return `${x(i)},${y(ideal)}`
  }).join(' ')

  const actualPoints = data.map((d, i) => `${x(i)},${y(d.remaining)}`).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const yv = PAD.t + innerH - f * innerH
        return (
          <g key={f}>
            <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={PAD.l - 4} y={yv + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.2)">
              {Math.round(maxVal * f)}
            </text>
          </g>
        )
      })}
      {/* Ideal */}
      <polyline points={idealPoints} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 3" />
      {/* Actual */}
      <polyline points={actualPoints} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" />
      {/* X axis labels */}
      {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1).map((d, _, arr) => {
        const i = data.indexOf(d)
        return (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.2)">
            {d.date.slice(5)}
          </text>
        )
      })}
      {/* Legend */}
      <line x1={PAD.l} y1={H - 18} x2={PAD.l + 16} y2={H - 18} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 3" strokeWidth={1} />
      <text x={PAD.l + 20} y={H - 14} fontSize={9} fill="rgba(255,255,255,0.2)">{t('analytics.ideal')}</text>
      <line x1={PAD.l + 55} y1={H - 18} x2={PAD.l + 71} y2={H - 18} stroke={BRAND} strokeWidth={2} />
      <text x={PAD.l + 75} y={H - 14} fontSize={9} fill="rgba(255,255,255,0.2)">{t('analytics.actual')}</text>
    </svg>
  )
}

// ——— Velocity Chart ———
function VelocityChart({ data }) {
  const { t } = useTranslation()
  if (!data || data.length === 0) {
    return <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, padding: '24px 0' }}>{t('analytics.completeOneCycle')}</div>
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
        return (
          <g key={d.cycle_id}>
            <text x={padding.l - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize={11} fill="rgba(255,255,255,0.5)">
              {d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name}
            </text>
            <rect x={padding.l} y={y} width={totalW} height={barH} rx={4} fill="rgba(255,255,255,0.06)">
              <title>{d.name}: {d.total_tasks} total tasks</title>
            </rect>
            <rect x={padding.l} y={y} width={doneW} height={barH} rx={4} fill="rgba(34,197,94,0.5)">
              <title>{d.name}: {d.completed_tasks} completed</title>
            </rect>
            <text x={padding.l + totalW + 6} y={y + barH / 2 + 4} fontSize={10} fill="rgba(255,255,255,0.3)">
              {d.completed_tasks}/{d.total_tasks}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ——— Status Trend ———
function StatusTrendChart({ data }) {
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

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map(f => {
        const yv = PAD.t + innerH - f * innerH
        return (
          <g key={f}>
            <line x1={PAD.l} y1={yv} x2={W - PAD.r} y2={yv} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={PAD.l - 4} y={yv + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.2)">{Math.round(maxTotal * f)}</text>
          </g>
        )
      })}
      {statuses.map(s => (
        <polyline key={s} points={lineFor(s)} fill="none" stroke={STATUS_COLORS[s]} strokeWidth={1.5} strokeLinejoin="round" opacity={0.8} />
      ))}
      {data.filter((_, i) => i % Math.ceil(data.length / 5) === 0).map((d, _, arr) => {
        const i = data.indexOf(d)
        return (
          <text key={i} x={PAD.l + (i / (data.length - 1)) * innerW} y={H - 4} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.2)">
            {d.date.slice(5)}
          </text>
        )
      })}
      {/* Legend */}
      {statuses.map((s, i) => (
        <g key={s}>
          <rect x={PAD.l + i * 80} y={H - 22} width={10} height={4} rx={2} fill={STATUS_COLORS[s]} />
          <text x={PAD.l + i * 80 + 14} y={H - 16} fontSize={9} fill="rgba(255,255,255,0.3)">{s}</text>
        </g>
      ))}
    </svg>
  )
}

function StatCard({ icon, label, value, sub, color, delay }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6,
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: delay != null ? `${delay}s` : '0s',
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || '#ffffff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, icon, children, delay, summary }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, padding: '20px 24px',
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: delay != null ? `${delay}s` : '0s',
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600 }}>
        {icon}{title}
      </div>
      {children}
      {summary && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
          {summary}
        </div>
      )}
    </div>
  )
}

export default function Analytics() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [trendDays, setTrendDays] = useState(30)

  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: getOverview, staleTime: 60000 })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects, staleTime: 30000 })
  const { data: cycles = [] } = useQuery({
    queryKey: ['cycles-all', selectedProjectId],
    queryFn: () => getCycles(selectedProjectId),
    enabled: !!selectedProjectId,
  })
  const { data: heatmap = [] } = useQuery({ queryKey: ['analytics-heatmap', selectedProjectId], queryFn: () => getHeatmap(selectedProjectId ? { project_id: selectedProjectId } : {}), staleTime: 60000 })
  const { data: burndown = [] } = useQuery({ queryKey: ['analytics-burndown', selectedCycleId], queryFn: () => getBurndown(selectedCycleId), enabled: !!selectedCycleId, staleTime: 30000 })
  const { data: velocity = [] } = useQuery({ queryKey: ['analytics-velocity', selectedProjectId], queryFn: () => getVelocity(selectedProjectId), enabled: !!selectedProjectId, staleTime: 30000 })
  const { data: trend = [] } = useQuery({ queryKey: ['analytics-trend', selectedProjectId, trendDays], queryFn: () => getStatusTrend(selectedProjectId || undefined, trendDays), staleTime: 30000 })

  const selectStyle = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#ffffff', outline: 'none', cursor: 'pointer',
  }

  return (
    <div className="page-content" style={{ padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <div style={{ marginBottom: isMobile ? 20 : 28 }}>
        <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: '#ffffff', margin: 0 }}>{t('analytics.title')}</h1>
        <p style={{ color: 'rgba(255,255,255,0.3)', marginTop: 4, fontSize: 13 }}>{t('analytics.subtitle')}</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setSelectedCycleId('') }} style={selectStyle}>
          <option value="">{t('analytics.allProjects')}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {selectedProjectId && cycles.length > 0 && (
          <select value={selectedCycleId} onChange={e => setSelectedCycleId(e.target.value)} style={selectStyle}>
            <option value="">{t('analytics.selectCycle')}</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select value={trendDays} onChange={e => setTrendDays(Number(e.target.value))} style={selectStyle}>
          <option value={7}>{t('analytics.last7Days')}</option>
          <option value={30}>{t('analytics.last30Days')}</option>
          <option value={90}>{t('analytics.last90Days')}</option>
        </select>
      </div>

      {/* Overview cards */}
      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard icon={<BarChart2 size={13}/>} label={t('analytics.totalTasks')} value={overview.total_tasks} delay={0} />
          <StatCard icon={<Activity size={13}/>} label={t('analytics.done')} value={overview.done_tasks} color="#22c55e" delay={0.08} />
          <StatCard icon={<TrendingUp size={13}/>} label={t('analytics.inProgress')} value={overview.in_progress_tasks} color="#3b82f6" delay={0.16} />
          <StatCard icon={<Flame size={13}/>} label={t('analytics.overdueCount')} value={overview.overdue_tasks} color="#ef4444" delay={0.24} />
          {overview.most_active_project && (
            <StatCard
              icon={<Activity size={13}/>}
              label={t('analytics.mostActive')}
              value={overview.most_active_project.name}
              sub={t('analytics.eventsThisWeek', { count: overview.most_active_project.activity_count })}
              color="#1ed760"
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
            <Section title={t('analytics.heatmap')} icon={<Activity size={13}/>} delay={0.05} summary={heatmapSummary}>
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
            <Section title={t('analytics.cycleBurndown')} icon={<TrendingUp size={13}/>} delay={0.13} summary={burndownSummary}>
              {!selectedCycleId ? (
                <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>{t('analytics.selectCycleForBurndown')}</div>
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
            <Section title={t('analytics.velocity')} icon={<BarChart2 size={13}/>} delay={0.21} summary={velocitySummary}>
              <VelocityChart data={velocity} />
            </Section>
          )
        })()}

        {/* Status Trend */}
        <Section title={t('analytics.statusTrend', { days: trendDays })} icon={<TrendingUp size={13}/>} delay={0.29}>
          <StatusTrendChart data={trend} />
        </Section>
      </div>
    </div>
  )
}
