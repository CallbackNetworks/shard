import TerrainChart from '../charts/TerrainChart'
import ContourMap from '../charts/ContourMap'
import ActivityHeatmap from '../charts/ActivityHeatmap'
import StatusTrendChart from '../charts/StatusTrendChart'
import BurndownChart from '../charts/BurndownChart'
import VelocityChart from '../charts/VelocityChart'
import now from './ShareNow.module.css'
import s from './ShareAnalytics.module.css'

// The section and its nav entry share one condition, so the entry never points at
// nothing. Status trend alone is not enough: it is 30 rows of zeros on an empty share.
export function hasAnalytics(a) {
  if (!a) return false
  return a.heatmap?.length > 0 || a.burndown?.length > 0 || a.velocity?.length > 0 ||
    a.status_trend?.some(d => d.todo + d.in_progress + d.done + d.failed > 0)
}

function Panel({ title, sub, wide, children }) {
  return (
    <div className={wide ? `${now.panel} ${s.wide}` : now.panel}>
      <div className={now.heading}>{title}{sub != null && <b>{sub}</b>}</div>
      {children}
    </div>
  )
}

// The analytics page's charts, drawn from the share payload rather than fetched:
// a guest has no session, and the numbers come from the same service either way.
export default function ShareAnalytics({ analytics, projects = [], bp }) {
  const mobile = bp === 'mobile'
  const { heatmap = [], by_project: byProject = [], status_trend: trend = [], burndown = [], velocity = [] } = analytics
  const yearTotal = heatmap.reduce((n, d) => n + d.count, 0)

  // A mountain per project: its size is its task count, its brightness how busy the
  // last 30 days were, read from the same per-project series the ridgeline draws.
  const since = Date.now() - 30 * 86400000
  const heatOf = id => (byProject.find(p => p.id === id)?.days || [])
    .reduce((n, d) => (new Date(`${d.date}T12:00:00`).getTime() >= since ? n + d.count : n), 0)
  const mountains = projects.map(p => ({ id: p.id, name: p.name, tasks: p.tasks || [], heat: heatOf(p.id) }))

  return (
    <section className={s.grid} aria-label="Analytics">
      <Panel title="Terrain · size = tasks, brightness = last 30 days" wide>
        <ContourMap projects={mountains} width={mobile ? 380 : 720} height={mobile ? 420 : 420} />
      </Panel>

      {byProject.length > 0 && (
        <Panel title={`Activity terrain · ${mobile ? 13 : 26} weeks`} wide>
          <TerrainChart series={byProject} weeks={mobile ? 13 : 26} width={mobile ? 380 : 720} />
        </Panel>
      )}

      <Panel title="Activity · 12 months" sub={yearTotal} wide>
        <ActivityHeatmap data={heatmap} />
      </Panel>

      <Panel title="Status trend · 30 days">
        <StatusTrendChart data={trend} />
      </Panel>

      {burndown.map(b => (
        <Panel key={`${b.project}-${b.cycle}`} title={`Burndown · ${b.project} / ${b.cycle}`}>
          <BurndownChart data={b.days} />
        </Panel>
      ))}

      {velocity.map(v => (
        <Panel key={v.project} title={`Velocity · ${v.project}`}>
          <VelocityChart data={v.cycles} />
        </Panel>
      ))}
    </section>
  )
}
