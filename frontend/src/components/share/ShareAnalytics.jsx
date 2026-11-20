import TerrainChart from '../charts/TerrainChart'
import ContourMap from '../charts/ContourMap'
import ActivityStrip from '../charts/ActivityStrip'
import StatusFlow from '../charts/StatusFlow'
import BurndownChart from '../charts/BurndownChart'
import VelocityChart from '../charts/VelocityChart'
import now from './ShareNow.module.css'
import s from './ShareAnalytics.module.css'

const DAY = 86400000

// A chart earns its panel by showing a change. A status trend whose 30 days are all
// the same day, a burndown whose line never moved, a velocity of one cycle: each is
// a flat line that only looks like information.
function charted(a) {
  const { heatmap = [], status_trend: trend = [], burndown = [], velocity = [] } = a || {}
  const key = d => `${d.todo}/${d.in_progress}/${d.done}/${d.failed}`
  return {
    heatmap: heatmap.some(d => d.count > 0) ? heatmap : [],
    trend: trend.some(d => key(d) !== key(trend[0])) ? trend : [],
    burndown: burndown.filter(b => b.days.length >= 3 && b.days.some(d => d.remaining !== b.days[0].remaining)),
    velocity: velocity.filter(v => v.cycles.length >= 2),
  }
}

// The section and its nav entry share one condition, so the entry never points at
// nothing.
export function hasAnalytics(a, projects = []) {
  if (!a) return false
  const c = charted(a)
  return projects.some(p => (p.tasks || []).length > 0) ||
    c.heatmap.length > 0 || c.trend.length > 0 || c.burndown.length > 0 || c.velocity.length > 0
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
  const { by_project: byProject = [] } = analytics
  const { heatmap, trend, burndown, velocity } = charted(analytics)
  const yearTotal = heatmap.reduce((n, d) => n + d.count, 0)

  // A mountain per project, from the per-project daily series: its brightness the
  // last 30 days of activity, its position on the ground how long since the last.
  const today = Date.now()
  const seriesOf = id => (byProject.find(p => p.id === id)?.days || []).filter(d => d.count > 0)
  const ageOf = d => Math.max(0, Math.floor((today - new Date(`${d.date}T12:00:00`).getTime()) / DAY))
  const mountains = projects.map(p => {
    const days = seriesOf(p.id)
    return {
      id: p.id,
      name: p.name,
      tasks: p.tasks || [],
      heat: days.filter(d => ageOf(d) < 30).reduce((n, d) => n + d.count, 0),
      lastActive: days.length ? Math.min(...days.map(ageOf)) : null,
    }
  })

  // The ridgeline answers "when was each project busy" — a different question from
  // the map's "where does the work stand now", so it is a view of the same panel
  // rather than a panel of its own.
  const timeline = byProject.length > 0 && {
    key: 'timeline',
    label: 'Timeline',
    render: () => <TerrainChart series={byProject} weeks={mobile ? 13 : 26} width={mobile ? 380 : 720} />,
  }

  return (
    <section className={s.grid} aria-label="Analytics">
      <Panel title="Terrain · width = all tasks, height = open, brightness = last 30 days" wide>
        <ContourMap
          projects={mountains}
          width={mobile ? 380 : 720}
          height={mobile ? 340 : 420}
          extraViews={timeline ? [timeline] : []}
        />
      </Panel>

      {heatmap.length > 0 && (
        <Panel title="Activity" sub={yearTotal} wide>
          <ActivityStrip data={heatmap} width={mobile ? 380 : 720} />
        </Panel>
      )}

      {trend.length > 0 && (
        <Panel title="Status flow · 30 days" wide>
          <StatusFlow data={trend} width={mobile ? 380 : 720} />
        </Panel>
      )}

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
