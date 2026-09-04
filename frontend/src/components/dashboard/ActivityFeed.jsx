import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { BRAND, DARK, STATUS_COLOR } from '../../constants/theme'
import { useNodeTypeMap } from '../../hooks/useNodeTypeMap'
import { activityHref } from '../../utils/nodeHref'
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

/**
 * The live-signals feed (ADR-0147).
 *
 * Every row already knew what it happened to — `ActivityLogOut` carries `task_id`,
 * `project_id` and the resolved `node_type` — and rendered it as text you could not
 * click. A row whose subject is reachable is a button; a row whose subject is not
 * (a delete, a system event naming nothing) stays a plain div rather than becoming a
 * button that goes nowhere, which is the whole difference between "this line is a
 * link" and "the app ignores clicks here for reasons you cannot see".
 */
export default function ActivityFeed({ activities }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const typeByKey = useNodeTypeMap()
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
        const href = activityHref(a, typeByKey)
        const Row = href ? 'button' : 'div'
        return (
          <Row
            key={a.id || i}
            type={href ? 'button' : undefined}
            onClick={href ? () => navigate(href) : undefined}
            className={`${s.activityItem} ${href ? s.activityItemLink : ''}`}
            style={{
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
          </Row>
        )
      })}
    </div>
  )
}
