import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import DonutChart from './charts/DonutChart'
import HeatmapChart from './charts/HeatmapChart'
import TrendLineChart from './charts/TrendLineChart'
import MindMapCanvas from './charts/MindMapCanvas'
import RadarChart from './charts/RadarChart'
import StackedBarChart from './charts/StackedBarChart'
import GaugeChart from './charts/GaugeChart'
import WaffleChart from './charts/WaffleChart'
import HorizontalBarChart from './charts/HorizontalBarChart'
import AreaChart from './charts/AreaChart'

const STATUS_COLORS = {
  done: '#1ed760',
  in_progress: '#539df5',
  todo: 'rgba(255,255,255,0.3)',
  failed: '#f3727f',
}

function StatCard({ label, value, color, delay = 0 }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 8,
      padding: '14px 16px',
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: `${delay}s`,
      opacity: 0,
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function Section({ title, children, style }) {
  return (
    <div style={{ marginBottom: 28, ...style }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function IdentityTab({ identity, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${identity.color}14` : 'transparent',
      border: 'none',
      borderBottom: `2px solid ${active ? identity.color : 'transparent'}`,
      cursor: 'pointer',
      padding: '8px 14px',
      fontSize: 11, fontWeight: active ? 700 : 400,
      color: active ? identity.color : 'rgba(255,255,255,0.4)',
      display: 'flex', alignItems: 'center', gap: 6,
      transition: 'all 0.15s',
      outline: 'none',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 2, background: identity.color, flexShrink: 0,
      }} />
      {identity.name}
    </button>
  )
}

function IdentityCard({ identity, onNavigate }) {
  const { t } = useTranslation()
  const rate = identity.total_tasks > 0
    ? Math.round((identity.done / identity.total_tasks) * 100) : 0

  const segments = [
    { value: identity.done, color: STATUS_COLORS.done, label: t('hub.done') },
    { value: identity.in_progress, color: STATUS_COLORS.in_progress, label: t('hub.inProgress') },
    { value: identity.todo, color: STATUS_COLORS.todo, label: t('hub.todoLabel') },
    { value: identity.failed, color: STATUS_COLORS.failed, label: t('hub.failed') },
  ]

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderTop: `2px solid ${identity.color}`,
      borderRadius: 10,
      padding: 20,
      boxShadow: `0 0 20px ${identity.color}10`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `linear-gradient(135deg, ${identity.color}cc, ${identity.color}66)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: '#fff', fontWeight: 800,
          boxShadow: `0 0 12px ${identity.color}44`,
        }}>
          {identity.avatar || identity.name.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{identity.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {identity.projects.length} {t('hub.projects')} · {identity.total_tasks} {t('hub.tasks')}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <DonutChart
          segments={segments}
          size={100}
          strokeWidth={8}
          centerText={`${rate}%`}
          centerSub={t('hub.completionRate')}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: t('hub.done'), value: identity.done, color: STATUS_COLORS.done },
            { label: t('hub.inProgress'), value: identity.in_progress, color: STATUS_COLORS.in_progress },
            { label: t('hub.todoLabel'), value: identity.todo, color: 'rgba(255,255,255,0.3)' },
            { label: t('hub.overdueCount'), value: identity.overdue, color: '#f87171' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.value > 0 ? '#fff' : 'rgba(255,255,255,0.2)' }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {identity.projects.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          {identity.projects.map(p => {
            const pPct = p.total_tasks > 0 ? Math.round((p.done / p.total_tasks) * 100) : 0
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                  cursor: onNavigate ? 'pointer' : 'default',
                }}
                onClick={() => onNavigate?.(p.id)}
              >
                <span style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {p.name}
                </span>
                <div style={{
                  width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', flexShrink: 0,
                }}>
                  <div style={{
                    width: `${pPct}%`, height: '100%', borderRadius: 2,
                    background: identity.color, transition: 'width 0.3s',
                  }} />
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', width: 30, textAlign: 'right', flexShrink: 0 }}>
                  {pPct}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PerspectiveSwitcher({ value, onChange }) {
  const { t } = useTranslation()
  const options = [
    { key: 'identity', label: t('hub.byIdentity') },
    { key: 'status', label: t('hub.byStatus') },
    { key: 'priority', label: t('hub.byPriority') },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          background: value === o.key ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: `1px solid ${value === o.key ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
          fontSize: 11, fontWeight: value === o.key ? 700 : 400,
          color: value === o.key ? '#fff' : 'rgba(255,255,255,0.4)',
          transition: 'all 0.15s', outline: 'none',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function buildTreesByIdentity(data) {
  return data.identities.map(ident => ({
    id: `ident-${ident.id}`,
    label: ident.name,
    color: ident.color,
    children: ident.projects.map(p => ({
      id: `proj-${p.id}`,
      label: p.name,
      color: ident.color,
      badge: p.total_tasks,
      projectId: p.id,
      children: [],
    })),
  }))
}

function buildTreesByStatus(data) {
  const statuses = ['todo', 'in_progress', 'done', 'failed']
  return statuses.map(status => ({
    id: `status-${status}`,
    label: status.replace('_', ' ').toUpperCase(),
    color: STATUS_COLORS[status],
    children: data.identities
      .filter(i => i[status] > 0)
      .map(ident => ({
        id: `status-${status}-ident-${ident.id}`,
        label: ident.name,
        color: ident.color,
        badge: ident[status],
        children: [],
      })),
  })).filter(s => s.children.length > 0)
}

function buildTreesByPriority(data) {
  const priorities = [
    { key: 'high', label: 'HIGH', color: '#f3727f' },
    { key: 'medium', label: 'MEDIUM', color: '#ffa42b' },
    { key: 'low', label: 'LOW', color: '#b3b3b3' },
  ]
  return priorities.map(pri => ({
    id: `pri-${pri.key}`,
    label: pri.label,
    color: pri.color,
    children: data.identities
      .filter(i => i.total_tasks > 0)
      .map(ident => ({
        id: `pri-${pri.key}-ident-${ident.id}`,
        label: ident.name,
        color: ident.color,
        children: ident.projects.filter(p => p.total_tasks > 0).map(p => ({
          id: `pri-${pri.key}-proj-${p.id}`,
          label: p.name,
          color: ident.color,
          badge: p.total_tasks,
          projectId: p.id,
          children: [],
        })),
      }))
      .filter(i => i.children.length > 0),
  })).filter(p => p.children.length > 0)
}


export default function IdentityChartsView({ data, selectedIdentityId, onSelectIdentity, onNavigate }) {
  const { t } = useTranslation()
  const [subView, setSubView] = useState('overview')
  const [perspective, setPerspective] = useState('identity')

  const identities = useMemo(() => data?.identities || [], [data])
  const totals = data?.totals || { total_tasks: 0, done: 0, in_progress: 0, todo: 0, failed: 0, overdue: 0 }

  const selectedIdent = selectedIdentityId
    ? identities.find(i => i.id === selectedIdentityId) || null
    : null
  const displayedIdentities = selectedIdent ? [selectedIdent] : identities

  const trendSeries = useMemo(() => {
    const idents = selectedIdent ? [selectedIdent] : identities
    return idents.map(ident => ({
      name: ident.name,
      color: ident.color,
      data: (ident.daily_activity || []).slice(-90).map(d => ({ date: d.date, value: d.count })),
    }))
  }, [identities, selectedIdent])

  const heatmapData = useMemo(() => {
    if (selectedIdent) return selectedIdent.daily_activity || []
    const merged = {}
    identities.forEach(i => {
      (i.daily_activity || []).forEach(d => {
        merged[d.date] = (merged[d.date] || 0) + d.count
      })
    })
    return Object.entries(merged).map(([date, count]) => ({ date, count }))
  }, [identities, selectedIdent])

  const trees = useMemo(() => {
    if (!data) return []
    if (perspective === 'status') return buildTreesByStatus(data)
    if (perspective === 'priority') return buildTreesByPriority(data)
    return buildTreesByIdentity(data)
  }, [data, perspective])

  const radarAxes = [
    { key: 'completion', label: t('hub.completionRate') },
    { key: 'volume', label: t('hub.volume') },
    { key: 'active', label: t('hub.activeRate') },
    { key: 'health', label: t('hub.health') },
    { key: 'scope', label: t('hub.scope') },
  ]

  const radarDatasets = useMemo(() => {
    return identities.map(ident => {
      const maxTasks = Math.max(...identities.map(i => i.total_tasks), 1)
      const maxProjects = Math.max(...identities.map(i => i.projects.length), 1)
      const completionRate = ident.total_tasks > 0 ? (ident.done / ident.total_tasks) * 100 : 0
      const volumeRate = (ident.total_tasks / maxTasks) * 100
      const activeRate = ident.total_tasks > 0 ? (ident.in_progress / ident.total_tasks) * 100 : 0
      const healthRate = ident.total_tasks > 0 ? Math.max(0, 100 - (ident.overdue / ident.total_tasks) * 200) : 100
      const scopeRate = (ident.projects.length / maxProjects) * 100
      return {
        name: ident.name,
        color: ident.color,
        values: [completionRate, volumeRate, activeRate, healthRate, scopeRate],
      }
    })
  }, [identities])

  const stackedBars = useMemo(() => {
    return identities.map(ident => ({
      label: ident.name,
      values: { done: ident.done, in_progress: ident.in_progress, todo: ident.todo, failed: ident.failed },
    }))
  }, [identities])

  const leaderboardItems = useMemo(() => {
    return [...identities]
      .map(i => ({
        label: i.name,
        value: i.total_tasks > 0 ? Math.round((i.done / i.total_tasks) * 100) : 0,
        displayValue: `${i.total_tasks > 0 ? Math.round((i.done / i.total_tasks) * 100) : 0}%`,
        color: i.color,
      }))
      .sort((a, b) => b.value - a.value)
  }, [identities])

  const areaLayers = useMemo(() => {
    return identities.map(ident => ({
      name: ident.name,
      color: ident.color,
      data: (ident.daily_activity || []).slice(-60).map(d => ({ date: d.date, value: d.count })),
    }))
  }, [identities])

  const handleNodeClick = (node) => {
    if (onNavigate && node.projectId) onNavigate(node.projectId)
  }

  if (identities.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
        {t('hub.noIdentities')}
      </div>
    )
  }

  const subViewTabs = [
    { key: 'overview', label: t('hub.overview') },
    { key: 'compare', label: t('hub.compare') },
    { key: 'activity', label: t('hub.activity') },
    { key: 'breakdown', label: t('hub.breakdown') },
    { key: 'mindmap', label: t('hub.mindMap') },
  ]

  return (
    <div>
      {/* Identity filter tabs */}
      <div style={{
        display: 'flex', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 4, flexWrap: 'wrap',
      }}>
        <button onClick={() => onSelectIdentity?.(null)} style={{
          background: !selectedIdentityId ? 'rgba(30,215,96,0.1)' : 'transparent',
          border: 'none',
          borderBottom: `2px solid ${!selectedIdentityId ? '#1ed760' : 'transparent'}`,
          cursor: 'pointer', padding: '8px 16px',
          fontSize: 11, fontWeight: !selectedIdentityId ? 700 : 400,
          color: !selectedIdentityId ? '#fff' : 'rgba(255,255,255,0.4)',
          transition: 'all 0.15s', outline: 'none',
        }}>
          {t('hub.all')}
        </button>
        {data.identities.map(ident => (
          <IdentityTab
            key={ident.id}
            identity={ident}
            active={selectedIdentityId === ident.id}
            onClick={() => onSelectIdentity?.(ident.id)}
          />
        ))}
      </div>

      {/* Sub-view tabs */}
      <div style={{
        display: 'flex', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 20,
      }}>
        {subViewTabs.map(tab => (
          <button key={tab.key} onClick={() => setSubView(tab.key)} style={{
            background: subView === tab.key ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: 'none',
            borderBottom: `2px solid ${subView === tab.key ? '#1ed760' : 'transparent'}`,
            cursor: 'pointer', padding: '8px 14px',
            fontSize: 11, fontWeight: subView === tab.key ? 700 : 400,
            color: subView === tab.key ? '#fff' : 'rgba(255,255,255,0.4)',
            transition: 'all 0.15s', outline: 'none', letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {subView === 'overview' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10, marginBottom: 24,
          }}>
            <StatCard label={t('hub.totalTasks')} value={selectedIdent ? selectedIdent.total_tasks : totals.total_tasks} color="#fff" delay={0} />
            <StatCard label={t('hub.completed')} value={selectedIdent ? selectedIdent.done : totals.done} color="#1ed760" delay={0.06} />
            <StatCard label={t('hub.inProgress')} value={selectedIdent ? selectedIdent.in_progress : totals.in_progress} color="#539df5" delay={0.12} />
            <StatCard label={t('hub.overdueCount')} value={selectedIdent ? selectedIdent.overdue : totals.overdue} color={(selectedIdent ? selectedIdent.overdue : totals.overdue) > 0 ? '#f87171' : '#fff'} delay={0.18} />
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}>
            {displayedIdentities.map(ident => (
              <IdentityCard
                key={ident.id}
                identity={ident}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Compare */}
      {subView === 'compare' && (
        <div>
          <Section title={t('hub.radarOverview')}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <RadarChart
                axes={radarAxes}
                datasets={selectedIdent ? radarDatasets.filter(d => d.name === selectedIdent.name) : radarDatasets}
                size={280}
              />
            </div>
          </Section>

          <Section title={t('hub.leaderboard')}>
            <HorizontalBarChart
              items={leaderboardItems}
              maxValue={100}
            />
          </Section>

          <Section title={t('hub.statusComparison')}>
            <StackedBarChart
              bars={selectedIdent
                ? stackedBars.filter(b => b.label === selectedIdent.name)
                : stackedBars
              }
              segments={[
                { key: 'done', label: t('hub.done'), color: STATUS_COLORS.done },
                { key: 'in_progress', label: t('hub.inProgress'), color: STATUS_COLORS.in_progress },
                { key: 'todo', label: t('hub.todoLabel'), color: STATUS_COLORS.todo },
                { key: 'failed', label: t('hub.failed'), color: STATUS_COLORS.failed },
              ]}
              horizontal
            />
          </Section>
        </div>
      )}

      {/* Activity */}
      {subView === 'activity' && (
        <div>
          <Section title={t('hub.activityHeatmap')}>
            <HeatmapChart
              data={heatmapData}
              color={selectedIdent?.color || '#1ed760'}
            />
          </Section>

          <Section title={t('hub.activityTrend')}>
            <TrendLineChart
              series={trendSeries}
              height={220}
              showArea={!!selectedIdent}
              showLegend={!selectedIdent}
            />
          </Section>

          {!selectedIdent && identities.length > 1 && (
            <Section title={t('hub.stackedActivity')}>
              <AreaChart
                layers={areaLayers}
                height={220}
              />
            </Section>
          )}
        </div>
      )}

      {/* Breakdown */}
      {subView === 'breakdown' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 16, marginBottom: 24,
          }}>
            {displayedIdentities.map(ident => {
              return (
                <div key={ident.id} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10, padding: 16,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ident.color }}>{ident.name}</div>
                  <GaugeChart
                    value={ident.done}
                    max={ident.total_tasks}
                    size={130}
                    color={ident.color}
                    label={`${ident.done}/${ident.total_tasks}`}
                  />
                </div>
              )
            })}
          </div>

          <Section title={t('hub.taskDistribution')}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 16,
            }}>
              {displayedIdentities.map(ident => (
                <div key={ident.id} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10, padding: 16,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: ident.color, marginBottom: 10 }}>
                    {ident.name}
                  </div>
                  <WaffleChart
                    segments={[
                      { value: ident.done, color: STATUS_COLORS.done, label: t('hub.done') },
                      { value: ident.in_progress, color: STATUS_COLORS.in_progress, label: t('hub.inProgress') },
                      { value: ident.todo, color: STATUS_COLORS.todo, label: t('hub.todoLabel') },
                      { value: ident.failed, color: STATUS_COLORS.failed, label: t('hub.failed') },
                    ]}
                    cols={8}
                    cellSize={12}
                  />
                </div>
              ))}
            </div>
          </Section>

          {!selectedIdent && identities.length > 1 && (
            <Section title={t('hub.verticalComparison')}>
              <StackedBarChart
                bars={stackedBars}
                segments={[
                  { key: 'done', label: t('hub.done'), color: STATUS_COLORS.done },
                  { key: 'in_progress', label: t('hub.inProgress'), color: STATUS_COLORS.in_progress },
                  { key: 'todo', label: t('hub.todoLabel'), color: STATUS_COLORS.todo },
                  { key: 'failed', label: t('hub.failed'), color: STATUS_COLORS.failed },
                ]}
              />
            </Section>
          )}
        </div>
      )}

      {/* Mind Map */}
      {subView === 'mindmap' && (
        <div>
          <PerspectiveSwitcher value={perspective} onChange={setPerspective} />
          <MindMapCanvas
            trees={trees}
            onNodeClick={handleNodeClick}
          />
        </div>
      )}
    </div>
  )
}
