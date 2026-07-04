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
const ACTIVITY_COLOR = {
  task: '#facc15',
  project: '#e5e7eb',
  decision: '#a78bfa',
  goal: '#34d399',
  webhook: '#60a5fa',
  alert: '#fb7185',
}
const ACTIVITY_BUCKETS = 22

// Bucket recent activity by time into stacked columns (volume = bar height,
// kind = coloured segments) so the strip reads as a compact chart, not text.
function buildActivityBars(activities) {
  const now = Date.now()
  const times = activities.map(eventTime)
  const fallbackStart = now - 6 * 60 * 60 * 1000
  const minTime = times.length ? Math.min(...times, fallbackStart) : fallbackStart
  const span = Math.max(now - minTime, 60 * 60 * 1000)
  const bucketMs = span / ACTIVITY_BUCKETS

  const buckets = Array.from({ length: ACTIVITY_BUCKETS }, (_, i) => ({ time: minTime + i * bucketMs, total: 0, kinds: {} }))
  const kindTotals = {}
  let total = 0
  for (const entry of activities) {
    const kind = eventKind(entry)
    if (!ACTIVITY_COLOR[kind]) continue
    const i = Math.max(0, Math.min(ACTIVITY_BUCKETS - 1, Math.floor((eventTime(entry) - minTime) / bucketMs)))
    buckets[i].kinds[kind] = (buckets[i].kinds[kind] || 0) + 1
    buckets[i].total += 1
    kindTotals[kind] = (kindTotals[kind] || 0) + 1
    total += 1
  }

  const peak = Math.max(1, ...buckets.map(b => b.total))
  const columns = buckets.map(b => ({
    time: b.time,
    total: b.total,
    height: b.total === 0 ? 0 : Math.round((0.16 + 0.84 * (b.total / peak)) * 100),
    segments: ACTIVITY_KINDS.filter(kind => b.kinds[kind]).map(kind => ({ kind, count: b.kinds[kind], color: ACTIVITY_COLOR[kind] })),
  }))
  const legend = ACTIVITY_KINDS.filter(kind => kindTotals[kind]).map(kind => ({ kind, color: ACTIVITY_COLOR[kind], total: kindTotals[kind] }))

  return { columns, legend, total, minTime, maxTime: now }
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
  const chart = useMemo(() => buildActivityBars(activities), [activities])

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
        <div className="kt-actchart" role="img" aria-label={`${chart.total} recent events over time`}>
          {chart.columns.map((col, i) => (
            <div
              key={i}
              className="kt-actbar"
              style={{ height: `${col.height}%` }}
              title={col.total ? `${col.total} events · ${formatTimelineTime(col.time)}` : undefined}
            >
              {col.segments.map(seg => (
                <i key={seg.kind} style={{ background: seg.color, flexGrow: seg.count }} />
              ))}
            </div>
          ))}
        </div>
        <div className="kt-signal-summary" aria-label="Activity type legend">
          {chart.legend.map(item => (
            <span key={item.kind}><i style={{ background: item.color, borderColor: item.color }} />{item.total} {item.kind}</span>
          ))}
        </div>
      </div>
    </>
  )
}
