import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Clock, Activity, AlertTriangle, CheckCircle2, Radio } from 'lucide-react'
import { densityCount } from '../../utils/uiPrefs'
import ActivityFeed from './ActivityFeed'
import s from '../../pages/Dashboard.module.css'

export function CommandHero({ command }) {
  const { t } = useTranslation()
  const { metrics } = command
  return (
    <div className={s.commandHero}>
      <div className={s.commandHeroMain}>
        <div className={s.commandEyebrow}>
          <Radio size={12} />
          {t('dashboard.commandCenter')}
        </div>
        <div className={s.commandHeadline}>
          <span>{metrics.activeTasks}</span>
          <em>ACTIVE</em>
        </div>
        <div className={s.commandSubline}>
          {metrics.overdue} {t('overdue')} / {metrics.failed} {t('failed')} / {metrics.inMotion} {t('dashboard.inMotion')}
        </div>
      </div>
      <div className={s.commandMetrics}>
        <div className={s.commandMetricWide}>
          <small>{t('dashboard.latestSignal')}</small>
          <strong>{metrics.latestSignal}</strong>
        </div>
      </div>
    </div>
  )
}

function PriorityLane({ title, tone, icon, tasks, empty, navigate }) {
  return (
    <div className={`${s.priorityLane} ${s[`priorityLane${tone}`] || ''}`}>
      <div className={s.priorityLaneHeader}>
        {icon}
        <span>{title}</span>
        <b>{tasks.length}</b>
      </div>
      <div className={s.priorityLaneList}>
        {tasks.length === 0 ? (
          <div className={s.priorityLaneEmpty}>{empty}</div>
        ) : tasks.slice(0, densityCount(5)).map((task, index) => (
          <button
            key={`${task.projectId}-${task.id}`}
            className={s.priorityTask}
            onClick={() => navigate(`/projects/${task.projectId}`)}
            style={{ animationDelay: `${index * 0.045}s` }}
          >
            <span className={s.priorityTaskTitle}>{task.title}</span>
            <span className={s.priorityTaskMeta}>{task.projectName}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function PriorityWall({ command }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { lanes } = command

  return (
    <div className={s.priorityWall}>
      <PriorityLane
        title={t('dashboard.critical')}
        tone="Risk"
        icon={<AlertTriangle size={14} />}
        tasks={lanes.critical}
        empty={t('dashboard.noCritical')}
        navigate={navigate}
      />
      <PriorityLane
        title={t('dashboard.inMotion')}
        tone="Motion"
        icon={<Activity size={14} />}
        tasks={lanes.inMotion}
        empty={t('dashboard.noInMotion')}
        navigate={navigate}
      />
      <PriorityLane
        title={t('dashboard.waiting')}
        tone="Waiting"
        icon={<Clock size={14} />}
        tasks={lanes.waiting}
        empty={t('dashboard.noWaiting')}
        navigate={navigate}
      />
      <PriorityLane
        title={t('dashboard.doneToday')}
        tone="Shipped"
        icon={<CheckCircle2 size={14} />}
        tasks={lanes.doneToday}
        empty={t('dashboard.noDoneToday')}
        navigate={navigate}
      />
    </div>
  )
}

function BriefingList({ items, renderItem, empty }) {
  if (!items.length) return <div className={s.briefingEmpty}>{empty}</div>
  return (
    <div className={s.briefingList}>
      {items.map(renderItem)}
    </div>
  )
}

export function OpsSidebar({ command }) {
  const { t } = useTranslation()
  const { briefing } = command

  return (
    <aside className={s.opsSidebar}>
      <div className={s.opsPanel}>
        <div className={s.opsPanelTitle}>{t('dashboard.liveSignals')}</div>
        <ActivityFeed activities={briefing.recentActivity} />
      </div>
      <div className={s.opsPanel}>
        <div className={s.opsPanelTitle}>{t('dashboard.briefing')}</div>
        <div className={s.briefingGrid}>
          <section>
            <b>{t('nav.goals')}</b>
            <BriefingList
              items={briefing.activeGoals}
              empty={t('dashboard.noGoalSignals')}
              renderItem={(goal, index) => (
                <div key={goal.id || index} className={s.briefingItem}>
                  <span>{goal.title || goal.name || goal.description || 'Goal'}</span>
                  <em>{goal.status || 'active'}</em>
                </div>
              )}
            />
          </section>
          <section>
            <b>{t('nav.decisions')}</b>
            <BriefingList
              items={briefing.pendingDecisions}
              empty={t('dashboard.noDecisionSignals')}
              renderItem={(decision, index) => (
                <div key={decision.id || index} className={s.briefingItem}>
                  <span>{decision.name || decision.title || 'Decision'}</span>
                  <em>{decision.decision_status || 'proposed'}</em>
                </div>
              )}
            />
          </section>
        </div>
      </div>
    </aside>
  )
}
