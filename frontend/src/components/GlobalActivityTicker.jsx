import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { getActivity, getProjects } from '../api/client'
import { useUiPrefs, refreshInterval } from '../utils/uiPrefs'

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

// Build smooth SVG paths (line + filled area) from the bucketed intensities.
// viewBox is 0..100 x 0..24; the SVG stretches to fill via preserveAspectRatio.
function sparkPaths(cells) {
  const n = cells.length
  if (n < 2) return { line: '', area: '' }
  const W = 100
  const H = 24
  const pts = cells.map((c, i) => ({
    x: (i / (n - 1)) * W,
    y: H - (0.12 + c.t * 0.8) * H, // keep a small margin off the top/bottom edges
  }))
  // Catmull-Rom -> cubic bezier for a smooth curve.
  let line = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    line += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  const area = `${line} L ${W},${H} L 0,${H} Z`
  return { line, area }
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
  const prefs = useUiPrefs()
  const { data: activities = [] } = useQuery({
    queryKey: ['global-activity-ticker'],
    queryFn: () => getActivity({ limit: 34 }),
    refetchInterval: refreshInterval(45000, prefs),
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
  const spark = useMemo(() => sparkPaths(chart.cells), [chart.cells])

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
        <svg
          className="kt-actheat"
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${chart.total} recent events over time`}
        >
          <defs>
            <linearGradient id="ktActArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ktActLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.22" />
              <stop offset="70%" stopColor="#facc15" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#fde047" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d={spark.area} fill="url(#ktActArea)" />
          <path
            d={spark.line}
            fill="none"
            stroke="url(#ktActLine)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="kt-heatscale" aria-label="Activity intensity scale">
          <span>LOW</span>
          <i />
          <span>HIGH</span>
        </div>
      </div>
    </>
  )
}
