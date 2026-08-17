import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Clock, ChevronDown, ChevronUp } from 'lucide-react'
import TaskRow from './TaskRow'
import s from '../../pages/Dashboard.module.css'
import { isDueWithin } from '../../utils/overdue'

export default function DueSoonPanel({ projects }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(true)

  const dueSoonTasks = projects.flatMap(p =>
    (p.tasks || [])
      .filter(task => isDueWithin(task, 7))
      .map(task => ({ ...task, projectName: p.name, projectId: p.id }))
  ).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))

  return (
    <div className={s.dueSoonPanel}>
      <button
        onClick={() => setCollapsed(v => !v)}
        className={s.dueSoonToggle}
        disabled={dueSoonTasks.length === 0}
      >
        <Clock size={13} color="#ffa42b" />
        <span className={s.dueSoonTitle}>
          {t('dashboard.dueSoon')}
        </span>
        <span className={s.dueSoonCount}>
          {dueSoonTasks.length}
        </span>
        {dueSoonTasks.length > 0 && (collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
      </button>

      {dueSoonTasks.length === 0 ? (
        <div className={s.dueSoonEmpty}>{t('dashboard.noTasksDue')}</div>
      ) : !collapsed && (
        <div className={s.dueSoonList}>
          {dueSoonTasks.map((task, i) => (
            <TaskRow
              key={task.id}
              t={task}
              i={i}
              total={dueSoonTasks.length}
              onClick={() => navigate(`/projects/${task.projectId}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
