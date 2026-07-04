import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { getActivity, getProjects } from '../api/client'

const FALLBACK_ITEMS = [
  'SHARD ONLINE',
  'ACTIVE WORKFLOW',
  'BUILD QUEUE',
  'DECISIONS LOG',
  'GOALS LIVE',
]

function eventLabel(entry) {
  if (!entry) return null
  const action = String(entry.action || '').replaceAll('.', ' ')
  const detail = entry.detail || entry.message || action
  return `${action.toUpperCase()} / ${detail}`.slice(0, 120)
}

function getProjectTasks(project) {
  return Array.isArray(project?.tasks) ? project.tasks : []
}

function eventKind(entry) {
  const action = String(entry?.action || '').toLowerCase()
  if (action.includes('webhook') || action.includes('delivery') || action.includes('integration')) return 'webhook'
  if (action.includes('decision')) return 'decision'
  if (action.includes('goal')) return 'goal'
  if (action.includes('project')) return 'project'
  if (action.includes('failed') || action.includes('overdue') || action.includes('deleted')) return 'alert'
  return 'task'
}

function eventTime(entry) {
  const raw = entry?.created_at || entry?.updated_at || entry?.timestamp
  const value = raw ? new Date(raw).getTime() : Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

function formatTimelineTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const HEATMAP_KINDS = ['task', 'project', 'decision', 'goal', 'webhook', 'alert']
const HEATMAP_COLOR = {
  task: '#facc15',
  project: '#e5e7eb',
  decision: '#a78bfa',
  goal: '#34d399',
  webhook: '#60a5fa',
  alert: '#fb7185',
}
const HEATMAP_BUCKETS = 24

// Bucket recent activity into a kind x time grid so the strip reads as a
// heatmap (colour intensity = volume) instead of a wall of event text.
function buildHeatmap(activities) {
  const now = Date.now()
  const times = activities.map(eventTime)
  const fallbackStart = now - 6 * 60 * 60 * 1000
  const minTime = times.length ? Math.min(...times, fallbackStart) : fallbackStart
  const span = Math.max(now - minTime, 60 * 60 * 1000)
  const bucketMs = span / HEATMAP_BUCKETS

  const grid = {}
  for (const kind of HEATMAP_KINDS) grid[kind] = new Array(HEATMAP_BUCKETS).fill(0)

  let total = 0
  for (const entry of activities) {
    const kind = eventKind(entry)
    if (!grid[kind]) continue
    const bucket = Math.max(0, Math.min(HEATMAP_BUCKETS - 1, Math.floor((eventTime(entry) - minTime) / bucketMs)))
    grid[kind][bucket] += 1
    total += 1
  }

  let peak = 0
  for (const kind of HEATMAP_KINDS) {
    for (const count of grid[kind]) if (count > peak) peak = count
  }
  peak = Math.max(peak, 1)

  const rows = HEATMAP_KINDS
    .map(kind => ({
      kind,
      color: HEATMAP_COLOR[kind],
      total: grid[kind].reduce((sum, count) => sum + count, 0),
      cells: grid[kind].map((count, i) => ({
        count,
        intensity: count === 0 ? 0 : 0.28 + 0.72 * (count / peak),
        time: minTime + i * bucketMs,
      })),
    }))
    .filter(row => row.total > 0)

  return { rows: rows.length ? rows : HEATMAP_KINDS.slice(0, 4).map(kind => ({
    kind,
    color: HEATMAP_COLOR[kind],
    total: 0,
    cells: new Array(HEATMAP_BUCKETS).fill(0).map((_, i) => ({ count: 0, intensity: 0, time: minTime + i * bucketMs })),
  })), total, minTime, maxTime: now }
}

export default function GlobalActivityTicker() {
  const { data: activities = [] } = useQuery({
    queryKey: ['global-activity-ticker'],
    queryFn: () => getActivity({ limit: 34 }),
    refetchInterval: 45000,
    staleTime: 30000,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const alerts = useMemo(() => {
    const tasks = projects.flatMap(getProjectTasks)
    const now = new Date()
    const overdue = tasks.filter(task =>
      task.due_date && task.status !== 'done' && new Date(task.due_date) < now
    ).length
    const failed = tasks.filter(task => task.status === 'failed').length
    const highActive = tasks.filter(task =>
      task.priority === 'high' && !['done', 'failed'].includes(task.status)
    ).length

    return [
      overdue > 0 ? `${overdue} OVERDUE TASK${overdue === 1 ? '' : 'S'}` : null,
      failed > 0 ? `${failed} FAILED TASK${failed === 1 ? '' : 'S'}` : null,
      highActive > 0 ? `${highActive} HIGH PRIORITY ACTIVE` : null,
    ].filter(Boolean)
  }, [projects])

  const activityItems = activities.map(eventLabel).filter(Boolean)
  const tickerItems = activityItems.length > 0 ? activityItems : FALLBACK_ITEMS
  const loopItems = [...tickerItems, ...tickerItems]
  const heatmap = useMemo(() => buildHeatmap(activities), [activities])

  return (
    <>
      <div className="kt-notice-stack">
        {alerts.length > 0 && (
          <div className="kt-alert-strip" role="status" aria-live="polite">
            <div className="kt-alert-strip-track">
              {[...alerts, ...alerts, ...alerts].map((alert, index) => (
                <span key={`${alert}-${index}`}>
                  <AlertTriangle size={13} />
                  {alert}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="kt-ticker" aria-label="Recent activity">
          <div className="kt-ticker-track">
            {loopItems.map((item, index) => (
              <span key={`${item}-${index}`}>{item}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="kt-signal-timeline" aria-label="Activity heatmap">
        <div className="kt-signal-timeline-head">
          <span>LIVE</span>
          <strong>{heatmap.total}</strong>
          <em>{`${formatTimelineTime(heatmap.minTime)} / ${formatTimelineTime(heatmap.maxTime)}`}</em>
        </div>
        <div className="kt-heatmap" role="img" aria-label={`${heatmap.total} recent events by type and time`}>
          {heatmap.rows.map(row => (
            <div key={row.kind} className="kt-heatmap-row">
              <i className="kt-heatmap-key" style={{ background: row.color }} title={row.kind} />
              <div className="kt-heatmap-cells">
                {row.cells.map((cell, i) => (
                  <span
                    key={i}
                    className="kt-heatmap-cell"
                    style={cell.count ? { background: row.color, opacity: cell.intensity } : undefined}
                    title={cell.count ? `${cell.count} ${row.kind} · ${formatTimelineTime(cell.time)}` : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="kt-signal-summary" aria-label="Activity type legend">
          {heatmap.rows.map(row => (
            <span key={row.kind}><i style={{ background: row.color, borderColor: row.color }} />{row.total} {row.kind}</span>
          ))}
        </div>
      </div>
    </>
  )
}
