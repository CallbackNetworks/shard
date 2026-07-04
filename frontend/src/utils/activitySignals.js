const GROUP_STYLES = {
  task: { marker: 'task', color: '#facc15' },
  project: { marker: 'project', color: '#f3f4f6' },
  decision: { marker: 'decision', color: '#facc15' },
  goal: { marker: 'goal', color: '#facc15' },
  rule: { marker: 'webhook', color: '#facc15' },
  webhook: { marker: 'webhook', color: '#facc15' },
  share: { marker: 'share', color: 'rgba(255,255,255,0.34)' },
  comment: { marker: 'comment', color: '#38bdf8' },
}

function toTime(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function actionGroup(entry) {
  return String(entry?.action || '').split('.')[0] || 'other'
}

export function signalStyle(group) {
  return GROUP_STYLES[group] || { marker: 'other', color: 'rgba(255,255,255,0.28)' }
}

export function buildActivitySignals(entries = [], projectMap = {}) {
  const validTimes = entries
    .map(entry => toTime(entry.created_at))
    .filter(time => time != null)
  const min = validTimes.length ? Math.min(...validTimes) : Date.now()
  const max = validTimes.length ? Math.max(...validTimes) : min
  const span = Math.max(1, max - min)

  return entries.map((entry, index) => {
    const group = actionGroup(entry)
    const style = signalStyle(group)
    const time = toTime(entry.created_at)
    const position = time == null ? 100 : Math.max(0, Math.min(100, ((time - min) / span) * 100))
    return {
      id: entry.id ?? `${entry.action || 'event'}-${index}`,
      index,
      entry,
      group,
      marker: style.marker,
      color: style.color,
      time,
      position,
      projectName: entry.project_id ? projectMap[entry.project_id] : '',
      detail: entry.detail || entry.action || 'Activity',
      action: entry.action || 'activity.unknown',
    }
  })
}

export function summarizeActivitySignals(signals = []) {
  const groups = {}
  for (const signal of signals) {
    if (!groups[signal.group]) {
      groups[signal.group] = {
        group: signal.group,
        count: 0,
        color: signal.color,
        marker: signal.marker,
        latest: null,
      }
    }
    groups[signal.group].count += 1
    if (!groups[signal.group].latest || (signal.time || 0) > (groups[signal.group].latest.time || 0)) {
      groups[signal.group].latest = signal
    }
  }
  return Object.values(groups).sort((a, b) => b.count - a.count || a.group.localeCompare(b.group))
}

export function bucketActivitySignals(signals = [], bucketCount = 24) {
  const count = Math.max(1, bucketCount)
  const buckets = Array.from({ length: count }, (_, index) => ({
    index,
    count: 0,
    groups: {},
  }))
  for (const signal of signals) {
    const bucketIndex = Math.min(count - 1, Math.max(0, Math.floor((signal.position / 100) * count)))
    buckets[bucketIndex].count += 1
    buckets[bucketIndex].groups[signal.group] = (buckets[bucketIndex].groups[signal.group] || 0) + 1
  }
  return buckets
}
