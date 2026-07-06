import { useTranslation } from 'react-i18next'
import { BRAND, DARK, STATUS_COLOR } from '../../constants/theme'
import s from '../../pages/Dashboard.module.css'

const ACTION_COLORS = {
  'task.created':        BRAND,
  'task.status_changed': '#f59e0b',
  'task.assigned':       '#3b82f6',
  'task.deleted':        STATUS_COLOR.failed,
  'project.created':     BRAND,
  'project.archived':    '#9ca3af',
  'project.deleted':     STATUS_COLOR.failed,
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function ActivityFeed({ activities }) {
  const { t } = useTranslation()
  if (!activities || activities.length === 0) {
    return (
      <div className={s.activityEmpty}>
        {t('dashboard.noActivityYet')}
      </div>
    )
  }
  return (
    <div>
      {activities.map((a, i) => {
        const color = ACTION_COLORS[a.action] || DARK.textMid
        return (
          <div key={a.id || i} className={s.activityItem} style={{
            borderBottom: i < activities.length - 1 ? `1px solid ${DARK.border}` : 'none',
            animationDelay: `${i * 0.04}s`,
          }}>
            <div className={s.activityDot} style={{ background: color, boxShadow: `0 0 6px ${color}88` }} />
            <div className={s.activityContent}>
              <div className={s.activityDetail}>{a.detail}</div>
              <div className={s.activityMeta}>
                {a.actor && <span>{a.actor}</span>}
                <span>{t('dashboard.timeAgo', { time: timeAgo(a.created_at) })}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
