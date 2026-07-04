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

function relativeTimelineTime(value) {
  const diff = Date.now() - value
  const mins = Math.max(0, Math.floor(diff / 60000))
  if (mins < 1) return 'NOW'
  if (mins < 60) return `${mins}M AGO`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}H AGO`
  return `${Math.floor(hours / 24)}D AGO`
}

function buildTimelineItems(activities) {
  const source = activities.slice(0, 12)
  const now = Date.now()
  const fallbackStart = now - (6 * 60 * 60 * 1000)
  const times = source.map(eventTime)
  const minTime = times.length ? Math.min(...times, fallbackStart) : fallbackStart
  const maxTime = times.length ? Math.max(...times, now) : now
  const span = Math.max(maxTime - minTime, 60 * 60 * 1000)

  return source
    .map((entry, index) => {
      const time = eventTime(entry)
      const position = Math.max(2, Math.min(98, ((time - minTime) / span) * 100))
      return {
        id: entry.id || `${entry.action || 'event'}-${time}-${index}`,
        kind: eventKind(entry),
        label: eventLabel(entry) || 'ACTIVITY',
        time,
        position,
        relative: relativeTimelineTime(time),
      }
    })
    .sort((a, b) => b.time - a.time)
}

function summarizeTimelineKinds(items) {
  const counts = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
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
  const timelineItems = buildTimelineItems(activities)
  const timelineStart = timelineItems[0]?.time
  const timelineEnd = timelineItems[timelineItems.length - 1]?.time
  const fallbackMarkers = ['task', 'project', 'decision', 'goal', 'webhook'].map((kind, index) => ({
    id: `fallback-${kind}`,
    kind,
    label: FALLBACK_ITEMS[index],
    time: Date.now(),
    position: 12 + index * 18,
    relative: index === 0 ? 'NOW' : 'READY',
  }))
  const signalItems = timelineItems.length > 0 ? timelineItems : fallbackMarkers
  const visibleSignals = signalItems.slice(0, 5)
  const kindSummary = summarizeTimelineKinds(signalItems)

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
      <div className="kt-signal-timeline" aria-label="Activity signal timeline">
        <div className="kt-signal-timeline-head">
          <span>LIVE TIMELINE</span>
          <strong>{signalItems.length}</strong>
          <em>
            {timelineStart && timelineEnd
              ? `${formatTimelineTime(timelineStart)} / ${formatTimelineTime(timelineEnd)}`
              : 'LIVE / NOW'}
          </em>
        </div>
        <div className="kt-signal-event-list">
          {visibleSignals.map((item, index) => (
            <article key={item.id} className={`kt-signal-event is-${item.kind}`}>
              <div className="kt-signal-event-time">
                <span>{index === 0 ? 'NOW' : item.relative}</span>
                <em>{formatTimelineTime(item.time)}</em>
              </div>
              <div className="kt-signal-event-line" aria-hidden="true">
                <i />
              </div>
              <div className="kt-signal-event-body">
                <b>{item.kind}</b>
                <span>{item.label}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="kt-signal-summary" aria-label="Activity type summary">
          {kindSummary.map(([kind, count]) => (
            <span key={kind}><i className={`is-${kind}`} />{count} {kind}</span>
          ))}
        </div>
      </div>
    </>
  )
}
