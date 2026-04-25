import { DIM, MID, HI } from '../OverviewViews'
import useScrollReveal from './useScrollReveal'

const ACTION_COLORS = {
  'task.done': '#22c55e',
  'task.status_changed': '#38bdf8',
  'task.created': '#38bdf8',
  'task.deleted': '#f87171',
  'task.failed': '#f87171',
  'project.created': '#1ed760',
  'project.archived': DIM,
  'share.viewed': 'rgba(255,255,255,0.15)',
}

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

function ActivityEntry({ entry, index }) {
  const color = ACTION_COLORS[entry.action] || DIM
  return (
    <div style={{
      display: 'flex', gap: 14, padding: '10px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      opacity: 0,
      animation: `slideInLeft 0.4s ease-out ${0.05 * index}s forwards`,
    }}>
      {/* Timeline dot + line */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        width: 16, flexShrink: 0, paddingTop: 4,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, flexShrink: 0,
          boxShadow: `0 0 8px ${color}44`,
        }} />
        <div style={{
          width: 1, flex: 1, background: 'rgba(255,255,255,0.05)',
          marginTop: 4,
        }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: MID, lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.detail || entry.action}
        </div>
        <div style={{
          display: 'flex', gap: 10, marginTop: 3,
        }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', fontVariantNumeric: 'tabular-nums' }}>
            {relativeTime(entry.created_at)}
          </span>
          {entry.actor && !entry.actor.startsWith('visitor:') && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
              {entry.actor}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ShareActivityFeed({ activity, bp }) {
  const [ref, visible] = useScrollReveal(0.1)

  if (!activity || activity.length === 0) return null

  // Filter out share.viewed entries for the public view
  const filtered = activity.filter(a => a.action !== 'share.viewed')
  if (filtered.length === 0) return null

  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(24px)',
      transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: DIM, marginBottom: 12,
        paddingLeft: 4,
      }}>
        RECENT ACTIVITY
      </div>
      <div style={{ paddingLeft: 4 }}>
        {filtered.map((entry, i) => (
          <ActivityEntry key={i} entry={entry} index={i} />
        ))}
      </div>
    </div>
  )
}
