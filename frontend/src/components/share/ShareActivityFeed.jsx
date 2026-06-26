import { DIM, MID } from '../OverviewViews'
import useScrollReveal from './useScrollReveal'
import { relativeTime } from './utils'

const ACTION_COLORS = {
  'task.done': '#00ff41',
  'task.status_changed': '#00f0ff',
  'task.created': '#00f0ff',
  'task.deleted': '#ff2d55',
  'task.failed': '#ff2d55',
  'project.created': '#00f0ff',
  'project.archived': DIM,
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

export default function ShareActivityFeed({ activity, bp: _bp }) {
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
