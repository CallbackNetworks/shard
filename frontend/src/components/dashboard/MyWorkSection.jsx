import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { densityCount } from '../../utils/uiPrefs'
import TaskRow from './TaskRow'
import s from '../../pages/Dashboard.module.css'

/* ── Identity group row ───────────────────────────────────────────── */
function IdentityGroup({ ident, tasks, navigate }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const visibleTasks = showAll ? tasks : tasks.slice(0, densityCount(8))

  return (
    <div style={{
      borderLeft: `3px solid ${ident.color}`,
      paddingLeft: 10,
    }}>
      <div className={s.identityGroupHeader}>
        <div className={s.identityGroupAvatar} style={{
          background: ident.color,
          boxShadow: `0 0 8px ${ident.color}66`,
        }}>
          {ident.avatar || ident.name.charAt(0)}
        </div>
        <span className={s.identityGroupName} style={{ color: ident.color }}>{ident.name}</span>
        <span className={s.identityGroupBadge} style={{
          background: `${ident.color}22`, color: ident.color,
        }}>
          {tasks.filter(task => task.status !== 'done').length}
        </span>
        <span className={s.identityGroupOpen}>
          {t('dashboard.open')}
        </span>
      </div>
      {visibleTasks.map((task, i) => (
        <TaskRow key={task.id + ident.id} t={task} i={i} total={visibleTasks.length}
          onClick={() => navigate(`/projects/${task.projectId}`)} />
      ))}
      {tasks.length > 8 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className={s.identityShowMore}
        >
          {t('dashboard.showMore', { count: tasks.length - 8 })}
        </button>
      )}
    </div>
  )
}

/* ── My Work ──────────────────────────────────────────────────────── */
export default function MyWorkSection({ projects }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const priorityOrder = { high: 0, medium: 1, low: 2 }

  const groups = {}
  const ungroupedTasks = []

  for (const p of projects) {
    if (!p.tasks) continue
    for (const task of p.tasks) {
      if (task.status === 'done') continue
      const taskData = { ...task, projectName: p.name, projectId: p.id }
      const pIdentities = p.identities || []
      if (pIdentities.length > 0) {
        for (const ident of pIdentities) {
          if (!groups[ident.id]) groups[ident.id] = { identity: ident, tasks: [] }
          groups[ident.id].tasks.push(taskData)
        }
      } else {
        ungroupedTasks.push(taskData)
      }
    }
  }

  const sortTasks = (tasks) => tasks.sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
    return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
  })

  const identityGroups = Object.values(groups).map(g => ({ ...g, tasks: sortTasks(g.tasks) }))
  sortTasks(ungroupedTasks)

  if (identityGroups.length === 0 && ungroupedTasks.length === 0) {
    return (
      <div className={s.myWorkEmpty}>
        {t('dashboard.noActiveTasks')}
      </div>
    )
  }

  const hasIdentities = identityGroups.length > 0

  return (
    <div className={s.myWorkList}>
      {identityGroups.map(({ identity: ident, tasks }) => (
        <IdentityGroup key={ident.id} ident={ident} tasks={tasks} navigate={navigate} />
      ))}
      {ungroupedTasks.length > 0 && (
        <div>
          {hasIdentities && (
            <div className={s.otherLabel}>{t('dashboard.other')}</div>
          )}
          {ungroupedTasks.slice(0, densityCount(8)).map((task, i) => (
            <TaskRow key={task.id} t={task} i={i} total={Math.min(ungroupedTasks.length, 8)}
              onClick={() => navigate(`/projects/${task.projectId}`)} />
          ))}
        </div>
      )}
    </div>
  )
}
