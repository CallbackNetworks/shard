import useScrollReveal from './useScrollReveal'
import { relativeTime } from './utils'
import { STATUS_COLOR } from '../../constants/theme'

const ACTION_COLORS = {
  'task.done': STATUS_COLOR.done,
  'task.status_changed': '#3b82f6',
  'task.created': '#3b82f6',
  'task.deleted': STATUS_COLOR.failed,
  'task.failed': STATUS_COLOR.failed,
  'project.created': '#3b82f6',
  'project.archived': 'rgba(255,255,255,0.28)',
}

function ActivityEntry({ entry, index }) {
  const color = ACTION_COLORS[entry.action] || 'rgba(255,255,255,0.28)'
  return (
    <div className="kt-share-activity-entry" style={{ '--share-accent': color, animationDelay: `${0.05 * index}s` }}>
      <div className="kt-share-activity-mark">
        <div />
        <span />
      </div>

      <div className="kt-share-activity-copy">
        <div className="kt-share-activity-detail">
          {entry.detail || entry.action}
        </div>
        <div className="kt-share-activity-meta">
          <span>
            {relativeTime(entry.created_at)}
          </span>
          {entry.actor && !entry.actor.startsWith('visitor:') && (
            <span>
              {entry.actor}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ShareActivityFeed({ activity, bp: _bp }) {
  const [ref, visible] = useScrollReveal(0.1)

  if (!activity || activity.length === 0) return null

  // Filter out share.viewed entries for the public view
  const filtered = activity.filter(a => a.action !== 'share.viewed')
  if (filtered.length === 0) return null

  return (
    <div ref={ref} className={visible ? 'kt-share-activity is-visible' : 'kt-share-activity'}>
      <div className="kt-share-section-label">
        RECENT ACTIVITY
      </div>
      <div className="kt-share-activity-list">
        {filtered.map((entry, i) => (
          <ActivityEntry key={i} entry={entry} index={i} />
        ))}
      </div>
    </div>
  )
}
