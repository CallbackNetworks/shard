import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Clock, Activity, AlertTriangle, CheckCircle2, Radio } from 'lucide-react'
import { densityCount } from '../../utils/uiPrefs'
import ActivityFeed from './ActivityFeed'
import s from '../../pages/Dashboard.module.css'
import { taskHref, activityHref, nodeHref } from '../../utils/nodeHref'
import { useNodeTypeMap } from '../../hooks/useNodeTypeMap'

/**
 * The hero's numbers are the same four questions the stat cards ask, phrased as a
 * headline — so they lead to the same slices (ADR-0147). Before this the whole
 * panel was un-clickable text, including "latest signal", which names one specific
 * thing that just happened and was the one line on the page most obviously asking
 * to be followed.
 */
function HeroCount({ to, count, label, navigate }) {
  return (
    <button type="button" className={s.commandSublineLink} onClick={() => navigate(to)}>
      {count} {label}
    </button>
  )
}

export function CommandHero({ command }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const typeByKey = useNodeTypeMap()
  const { metrics } = command
  const signalHref = activityHref(metrics.latestActivity, typeByKey)
  return (
    <div className={s.commandHero}>
      <div className={s.commandHeroMain}>
        <div className={s.commandEyebrow}>
          <Radio size={12} />
          {t('dashboard.commandCenter')}
        </div>
        <button type="button" className={`${s.commandHeadline} ${s.commandHeadlineLink}`} onClick={() => navigate('?tab=tasks&only=active')}>
          <span>{metrics.activeTasks}</span>
          <em>ACTIVE</em>
        </button>
        <div className={s.commandSubline}>
          <HeroCount to="?tab=tasks&only=overdue" count={metrics.overdue} label={t('overdue')} navigate={navigate} />
          <span aria-hidden="true">/</span>
          <HeroCount to="?tab=tasks&only=failed" count={metrics.failed} label={t('failed')} navigate={navigate} />
          <span aria-hidden="true">/</span>
          <HeroCount to="?tab=tasks&only=in_progress" count={metrics.inMotion} label={t('dashboard.inMotion')} navigate={navigate} />
        </div>
      </div>
      <div className={s.commandMetrics}>
        <div className={s.commandMetricWide}>
          <small>{t('dashboard.latestSignal')}</small>
          {signalHref ? (
            <button type="button" className={s.commandSignalLink} onClick={() => navigate(signalHref)}>
              {metrics.latestSignal}
            </button>
          ) : (
            <strong>{metrics.latestSignal}</strong>
          )}
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
            onClick={() => navigate(taskHref(task))}
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

/**
 * A briefing line is a named record — a goal, an open decision — and naming one
 * without offering a way to open it is the whole defect (ADR-0147). `nodeHref`
 * decides the destination rather than this component, so a goal and a decision are
 * routed by the same rule that routes them from the ancestry strip and the palette.
 */
function BriefingRow({ node, state, typeByKey, navigate }) {
  const href = node?.id ? nodeHref(node, typeByKey) : null
  const Row = href ? 'button' : 'div'
  return (
    <Row
      type={href ? 'button' : undefined}
      onClick={href ? () => navigate(href) : undefined}
      className={`${s.briefingItem} ${href ? s.briefingItemLink : ''}`}
    >
      <span>{node.title || node.name || node.description || node.id}</span>
      <em>{state}</em>
    </Row>
  )
}

export function OpsSidebar({ command }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const typeByKey = useNodeTypeMap()
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
                <BriefingRow
                  key={goal.id || index}
                  node={{ ...goal, type: goal.type || 'goal' }}
                  state={goal.status || 'active'}
                  typeByKey={typeByKey}
                  navigate={navigate}
                />
              )}
            />
          </section>
          <section>
            <b>{t('nav.decisions')}</b>
            <BriefingList
              items={briefing.pendingDecisions}
              empty={t('dashboard.noDecisionSignals')}
              renderItem={(decision, index) => (
                <BriefingRow
                  key={decision.id || index}
                  node={{ ...decision, type: decision.type || 'decision' }}
                  state={decision.decision_status || 'proposed'}
                  typeByKey={typeByKey}
                  navigate={navigate}
                />
              )}
            />
          </section>
        </div>
      </div>
    </aside>
  )
}
