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

const ACTIVITY_KINDS = ['task', 'project', 'decision', 'goal', 'webhook', 'alert']
const ACTIVITY_BUCKETS = 52

// Cool -> hot ramp: faint void, indigo, wine, ember, amber, white-hot.
const HEAT_STOPS = [
  [0.0, [34, 20, 52]],
  [0.22, [76, 29, 149]],
  [0.44, [157, 23, 77]],
  [0.64, [194, 65, 12]],
  [0.82, [245, 158, 11]],
  [1.0, [254, 243, 199]],
]

function heatColor(t) {
  if (t <= 0) return 'rgba(255,255,255,0.045)'
  const clamped = Math.min(1, t)
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i]
    if (clamped <= p1) {
      const [p0, c0] = HEAT_STOPS[i - 1]
      const f = (clamped - p0) / (p1 - p0 || 1)
      const mix = c0.map((v, k) => Math.round(v + (c1[k] - v) * f))
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
    }
  }
  return 'rgb(254, 243, 199)'
}

// Bucket recent activity by time, then lightly smooth it so the strip reads
// as a continuous cool->hot heat line rather than isolated specks.
function buildActivityHeat(activities) {
  const now = Date.now()
  const times = activities.map(eventTime)
  const fallbackStart = now - 6 * 60 * 60 * 1000
  const minTime = times.length ? Math.min(...times, fallbackStart) : fallbackStart
  const span = Math.max(now - minTime, 60 * 60 * 1000)
  const bucketMs = span / ACTIVITY_BUCKETS

  const raw = new Array(ACTIVITY_BUCKETS).fill(0)
  let total = 0
  for (const entry of activities) {
    const kind = eventKind(entry)
    if (!ACTIVITY_KINDS.includes(kind)) continue
    const i = Math.max(0, Math.min(ACTIVITY_BUCKETS - 1, Math.floor((eventTime(entry) - minTime) / bucketMs)))
    raw[i] += 1
    total += 1
  }

  const kernel = [0.25, 0.55, 1, 0.55, 0.25]
  const smoothed = raw.map((_, i) => {
    let sum = 0
    for (let k = -2; k <= 2; k++) {
      const j = i + k
      if (j >= 0 && j < ACTIVITY_BUCKETS) sum += raw[j] * kernel[k + 2]
    }
    return sum
  })
  const peak = Math.max(1, ...smoothed)

  const cells = raw.map((count, i) => ({
    count,
    time: minTime + i * bucketMs,
    t: smoothed[i] === 0 ? 0 : Math.min(1, smoothed[i] / peak),
  }))

  return { cells, total, minTime, maxTime: now }
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
  const chart = useMemo(() => buildActivityHeat(activities), [activities])

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
      <div className="kt-signal-timeline" aria-label="Activity chart">
        <div className="kt-signal-timeline-head">
          <span>LIVE</span>
          <strong>{chart.total}</strong>
          <em>{`${formatTimelineTime(chart.minTime)} / ${formatTimelineTime(chart.maxTime)}`}</em>
        </div>
        <div className="kt-actheat" role="img" aria-label={`${chart.total} recent events over time`}>
          {chart.cells.map((cell, i) => (
            <span
              key={i}
              className="kt-actheat-cell"
              style={{ background: heatColor(cell.t), boxShadow: cell.t > 0.66 ? `0 0 7px ${heatColor(cell.t)}` : undefined }}
              title={cell.count ? `${cell.count} events · ${formatTimelineTime(cell.time)}` : undefined}
            />
          ))}
          <em className="kt-actheat-now" aria-hidden="true" />
        </div>
        <div className="kt-heatscale" aria-label="Activity intensity scale">
          <span>LOW</span>
          <i />
          <span>HIGH</span>
        </div>
      </div>
    </>
  )
}
