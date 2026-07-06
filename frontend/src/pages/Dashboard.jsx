import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderOpen, Archive, Clock, User, Activity, ChevronDown, ChevronUp, BarChart2, TrendingUp, Shield, ListChecks, GitCompare, AlertTriangle, CheckCircle2, Radio, Settings, Eye, EyeOff } from 'lucide-react'
import { getProjects, createProject, deleteProject, getActivity, getIdentityHubStats, getGoals, getDecisions, getPreference, setPreference } from '../api/client'
import AgentTasksPanel from '../components/AgentTasksPanel'
import IdentityChartsView from '../components/IdentityChartsView'
import { ViewProgress, ViewHealth, ViewTasks, ViewCompare, getPinnedIds, togglePin } from '../components/OverviewViews'
import { BRAND, STATUS_MAP, PRIORITY, DARK, STATUS_COLOR } from '../constants/theme'
import { deriveCommandCenter } from '../utils/commandCenter'
import { useUiPrefs, densityCount } from '../utils/uiPrefs'
import useBreakpoint from '../hooks/useBreakpoint'
import s from './Dashboard.module.css'

/* ── Shimmer progress bar ─────────────────────────────────────────── */
function GlowBar({ done, inProgress, failed, total }) {
  if (total === 0) return (
    <div className={s.glowBarEmpty} />
  )
  const pDone = (done / total) * 100
  const pProg = (inProgress / total) * 100
  const pFail = (failed / total) * 100
  return (
    <div className={s.glowBarTrack}>
      <div className={s.glowBarInner}>
        {pDone > 0 && (
          <div className={s.glowBarDone} style={{
            width: `${pDone}%`,
            background: STATUS_MAP.done.color,
          }}>
            <div className={s.glowBarShimmer} />
          </div>
        )}
        {pProg > 0 && <div className={s.glowBarProgress} style={{ width: `${pProg}%`, background: STATUS_MAP.in_progress.color }} />}
        {pFail > 0 && <div className={s.glowBarFailed} style={{ width: `${pFail}%`, background: STATUS_MAP.failed.color }} />}
      </div>
    </div>
  )
}

/* ── Project card ─────────────────────────────────────────────────── */
function ProjectCard({ project, onDelete, index }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const tasks = project.tasks || []
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const pct = Math.round(project.progress || 0)
  const identColor = project.identities?.[0]?.color || BRAND

  return (
    <div
      className={`card-hover ${s.projectCard}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{ animationDelay: `${index * 0.055}s` }}
    >
      {/* Subtle gradient top accent */}
      <div className={s.projectCardAccent} style={{
        background: `linear-gradient(90deg, transparent, ${identColor}66, transparent)`,
      }} />

      {/* Card header */}
      <div className={s.cardHeader}>
        <div className={s.cardAvatar} style={{
          background: `linear-gradient(135deg, ${identColor}cc, ${identColor}66)`,
          boxShadow: `0 0 12px ${identColor}44`,
        }}>
          {project.name.charAt(0).toUpperCase()}
        </div>
        <div className={s.cardInfo}>
          <div className={s.cardTitle}>
            {project.name}
          </div>
          {project.description && (
            <div className={s.cardDescription}>
              {project.description}
            </div>
          )}
        </div>
        <span className={`${s.statusBadge} ${project.status === 'archived' ? s.statusBadgeArchived : s.statusBadgeActive}`}>
          {project.status === 'archived' ? t('archived') : t('active')}
        </span>
      </div>

      {/* Progress bar */}
      <GlowBar total={project.total_tasks} done={project.done_tasks} inProgress={inProgress} failed={failed} />

      {/* Stats row */}
      <div className={s.statsRow}>
        <div className={s.statsLeft}>
          <span className={s.statsDone}>
            ✓ {project.done_tasks}
          </span>
          <span className={s.statsRemaining}>
            ○ {project.total_tasks - project.done_tasks} {t('dashboard.left')}
          </span>
        </div>
        <span className={s.statsPercent} style={{
          color: pct === 100 ? DARK.success : DARK.textMid,
        }}>
          {pct}%
        </span>
        {hovered && (
          <button
            onClick={e => {
              e.stopPropagation()
              if (confirm(`Delete "${project.name}"?`)) onDelete(project.id)
            }}
            className={s.deleteBtn}
          >
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Activity feed ────────────────────────────────────────────────── */
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

function ActivityFeed({ activities }) {
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

function CommandHero({ command, onNewProject }) {
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
        <div className={s.commandMetric}>
          <span>{metrics.completion}%</span>
          <small>{t('dashboard.completionRate')}</small>
        </div>
        <div className={s.commandMetric}>
          <span>{metrics.projects}</span>
          <small>{t('nav.projects')}</small>
        </div>
        <div className={s.commandMetricWide}>
          <small>{t('dashboard.latestSignal')}</small>
          <strong>{metrics.latestSignal}</strong>
        </div>
        <button onClick={onNewProject} className={s.commandAction}>
          <Plus size={14} /> {t('dashboard.newProject')}
        </button>
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

function PriorityWall({ command }) {
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

function OpsSidebar({ command }) {
  const { t } = useTranslation()
  const { metrics, briefing } = command

  return (
    <aside className={s.opsSidebar}>
      <div className={s.opsPanel}>
        <div className={s.opsPanelTitle}>{t('dashboard.liveSignals')}</div>
        <ActivityFeed activities={briefing.recentActivity} />
      </div>
      <div className={s.opsPanel}>
        <div className={s.opsPanelTitle}>{t('dashboard.queuePressure')}</div>
        <div className={s.pressureRows}>
          <div><span>{command.lanes.critical.length}</span><em>{t('dashboard.critical')}</em></div>
          <div><span>{metrics.failed}</span><em>{t('failed')}</em></div>
          <div><span>{metrics.projects}</span><em>{t('active')} {t('nav.projects')}</em></div>
        </div>
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

/* ── Task row (reused in Due Soon section) ────────────────────────── */
function TaskRow({ t: task, i, total, onClick }) {
  const [hov, setHov] = useState(false)
  const sc = STATUS_MAP[task.status]?.color || DARK.textMid
  const pc = PRIORITY[task.priority]?.color || DARK.textMid
  const overdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={`${s.taskRow} ${overdue ? s.taskRowOverdue : ''} ${!overdue && hov ? s.taskRowHover : ''}`}
      style={{
        borderBottom: i < total - 1 ? `1px solid ${DARK.border}` : 'none',
      }}
    >
      <div className={s.taskStatusDot} style={{ background: sc, boxShadow: `0 0 5px ${sc}66` }} />
      <span className={s.taskPriorityIcon} style={{ color: pc }}>
        {PRIORITY[task.priority]?.icon}
      </span>
      <div className={s.taskTitleWrap}>
        <div className={s.taskTitle} style={{
          color: task.status === 'done' ? DARK.textDim : DARK.textMid,
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>
      </div>
      <span className={s.taskProject}>{task.projectName}</span>
      {task.due_date && (
        <span className={s.taskDueDate} style={{
          color: overdue ? STATUS_COLOR.failed : DARK.textDim,
        }}>
          <Clock size={9} />
          {new Date(task.due_date).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}

/* ── Sparkline SVG ────────────────────────────────────────────────── */
function computeSparkline(activities) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toDateString()
  })
  return days.map(day =>
    activities.filter(a =>
      a.action === 'task.status_changed' &&
      a.detail?.includes('done') &&
      new Date(a.created_at).toDateString() === day
    ).length
  )
}

function Sparkline({ activities }) {
  const sparkData = computeSparkline(activities)
  const maxVal = Math.max(...sparkData, 1)
  const points = sparkData.map((v, i) =>
    `${(i / 6) * 76 + 2},${22 - (v / maxVal) * 20}`
  ).join(' ')
  return (
    <svg width={80} height={24} className={s.sparkline}>
      <polyline
        points={points}
        fill="none"
        stroke={BRAND}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CountUpValue({ value }) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+%?$/.test(value)
    ? Number(value.replace('%', ''))
    : null
  const suffix = typeof value === 'string' && value.endsWith('%') ? '%' : ''
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (numeric == null) return
    let raf = 0
    const start = performance.now()
    const duration = 620
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(numeric * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [numeric])

  return numeric == null ? value : `${shown}${suffix}`
}

/* ── Summary stat cards ───────────────────────────────────────────── */
function StatCards({ projects, activities }) {
  const { t } = useTranslation()

  const allTasks = projects.flatMap(p => p.tasks || [])
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter(task => task.status === 'done').length
  const overdueTasks = allTasks.filter(task =>
    task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  ).length
  const completionRate = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0

  const today = new Date().toDateString()
  const completedToday = activities.filter(a =>
    a.action === 'task.status_changed' &&
    a.detail?.includes('done') &&
    new Date(a.created_at).toDateString() === today
  ).length

  const cards = [
    {
      label: t('dashboard.totalTasks'),
      value: totalTasks,
      color: DARK.text,
      delay: 0,
    },
    {
      label: t('dashboard.completedToday'),
      value: completedToday,
      color: DARK.success,
      delay: 0.06,
    },
    {
      label: t('dashboard.overdueCount'),
      value: overdueTasks,
      color: overdueTasks > 0 ? STATUS_COLOR.failed : DARK.text,
      delay: 0.12,
    },
    {
      label: t('dashboard.completionRate'),
      value: `${completionRate}%`,
      color: completionRate === 100 ? BRAND : DARK.text,
      delay: 0.18,
      sparkline: true,
    },
  ]

  return (
    <div className={s.statCardsGrid}>
      {cards.map((card, idx) => (
        <div
          key={idx}
          className={s.statCard}
          style={{ animationDelay: `${card.delay}s` }}
        >
          <div className={s.statCardLabel}>{card.label}</div>
          <div className={s.statCardValue} style={{ color: card.color }}>
            <CountUpValue value={card.value} />
          </div>
          {card.sparkline && <Sparkline activities={activities} />}
        </div>
      ))}
    </div>
  )
}

/* ── Due Soon panel ───────────────────────────────────────────────── */
function DueSoonPanel({ projects }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(true)

  const now = new Date()
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const dueSoonTasks = projects.flatMap(p =>
    (p.tasks || [])
      .filter(task => task.due_date && task.status !== 'done' && new Date(task.due_date) <= nextWeek)
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
function MyWorkSection({ projects }) {
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

/* ── Onboarding getting started ───────────────────────────────────── */
function GettingStarted({ onNewProject, isMobile }) {
  const { t } = useTranslation()

  const steps = [
    {
      num: 1,
      title: t('dashboard.step1Title'),
      desc: t('dashboard.step1Desc'),
      gradient: 'linear-gradient(135deg, #facc15, #eab308)',
      action: <button
        onClick={onNewProject}
        className={s.stepActionBtn}
      >
        <Plus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        {t('dashboard.newProject')}
      </button>,
    },
    {
      num: 2,
      title: t('dashboard.step2Title'),
      desc: t('dashboard.step2Desc'),
      gradient: 'linear-gradient(135deg, #facc15, #eab308)',
    },
    {
      num: 3,
      title: t('dashboard.step3Title'),
      desc: t('dashboard.step3Desc'),
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    },
    {
      num: 4,
      title: t('dashboard.step4Title'),
      desc: t('dashboard.step4Desc'),
      gradient: 'linear-gradient(135deg, #fde047, #ca8a04)',
    },
  ]

  return (
    <div className={s.gettingStartedWrap}>
      <div className={s.gettingStartedHeader}>
        <div className={s.gettingStartedTitle}>
          {t('dashboard.gettingStarted')}
        </div>
        <div className={s.gettingStartedSubtitle}>{t('dashboard.createFirstProject')}</div>
      </div>
      <div className={`${s.stepsGrid} ${isMobile ? s.stepsGridMobile : s.stepsGridDesktop}`}>
        {steps.map((step, i) => (
          <div
            key={step.num}
            className={s.stepCard}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className={s.stepNumber} style={{ background: step.gradient }}>
              {step.num}
            </div>
            <div className={s.stepTitle}>{step.title}</div>
            <div className={s.stepDesc}>{step.desc}</div>
            {step.action}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Dashboard ────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  useUiPrefs() // re-render on list-density / timestamp preference changes
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const { data: activities = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => getActivity({ limit: 50 }),
    staleTime: 10000,
  })
  const { data: goals = [] } = useQuery({
    queryKey: ['goals', 'command-center'],
    queryFn: () => getGoals(),
    staleTime: 30000,
  })
  const { data: decisions = [] } = useQuery({
    queryKey: ['decisions', 'command-center'],
    queryFn: () => getDecisions(),
    staleTime: 30000,
  })
  const { data: hubStats } = useQuery({
    queryKey: ['identity-hub-stats'],
    queryFn: getIdentityHubStats,
    staleTime: 60000,
  })
  const DEFAULT_WIDGETS = { 'stat-cards': true, 'command-hero': true, 'priority-wall': true, 'agent-tasks': true, 'due-soon': true, 'ops-sidebar': true, 'projects-grid': true }
  const { data: savedWidgets } = useQuery({
    queryKey: ['preference', 'dashboard-widgets'],
    queryFn: () => getPreference('dashboard-widgets'),
    staleTime: 60000,
  })
  const [widgetVis, setWidgetVis] = useState(DEFAULT_WIDGETS)
  const [showWidgetConfig, setShowWidgetConfig] = useState(false)
  useEffect(() => {
    if (savedWidgets?.value) setWidgetVis({ ...DEFAULT_WIDGETS, ...savedWidgets.value })
  }, [savedWidgets])
  const toggleWidget = useCallback((id) => {
    setWidgetVis(prev => {
      const next = { ...prev, [id]: !prev[id] }
      setPreference('dashboard-widgets', next).catch(() => {})
      return next
    })
  }, [])
  const w = (id) => widgetVis[id] !== false
  const [chartIdentityId, setChartIdentityId] = useState(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('active')
  const [tab, setTab] = useState('projects')
  const [pinned, setPinned] = useState(() => getPinnedIds())
  const handleTogglePin = useCallback((projectId) => {
    setPinned(togglePin(projectId))
  }, [])

  const createMut = useMutation({
    mutationFn: () => createProject({ name: name.trim(), description: desc.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setName(''); setDesc(''); setShowForm(false) },
  })

  const deleteMut = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  const active = projects.filter(p => p.status === 'active')
  const archived = projects.filter(p => p.status === 'archived')
  const displayed = filter === 'all' ? projects : filter === 'archived' ? archived : active
  const command = deriveCommandCenter(projects, activities, goals, decisions)

  // Time-of-day greeting
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('dashboard.goodMorning')
    : hour < 18
    ? t('dashboard.goodAfternoon')
    : t('dashboard.goodEvening')

  const isEmptyState = projects.length === 0 && activities.length === 0

  return (
    <div className={s.dashboardRoot}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerContent}>
          <div className={s.headerGreeting}>{greeting}</div>
          <h1 className={s.headerTitle}>{t('dashboard.title')}</h1>
          <div className={s.headerStats}>
            <span className={s.headerStatsActive}>{active.length}</span> {t('active')} ·{' '}
            <span className={s.headerStatsArchived}>{archived.length}</span> {t('archived')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowWidgetConfig(v => !v)}
            title="Configure widgets"
            style={{
              background: showWidgetConfig ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
              padding: '7px 10px', cursor: 'pointer', color: DARK.textMid,
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
            }}
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className={s.newProjectBtn}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.background = '#eab308' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = BRAND }}
          >
            <Plus size={14} /> {t('dashboard.newProject')}
          </button>
        </div>
      </div>

      {/* Widget configuration panel */}
      {showWidgetConfig && (
        <div style={{
          background: DARK.surface, border: `1px solid ${DARK.border}`, borderRadius: 10,
          padding: '12px 16px', margin: '0 0 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: DARK.textMid, fontWeight: 600, marginRight: 8 }}>Widgets:</span>
          {[
            { id: 'stat-cards', label: 'Stats' },
            { id: 'command-hero', label: 'Overview' },
            { id: 'priority-wall', label: 'Priority Lanes' },
            { id: 'agent-tasks', label: 'Agent Tasks' },
            { id: 'due-soon', label: 'Due Soon' },
            { id: 'ops-sidebar', label: 'Signals & Briefing' },
            { id: 'projects-grid', label: 'Projects' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => toggleWidget(item.id)}
              style={{
                background: w(item.id) ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${w(item.id) ? 'rgba(250,204,21,0.3)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                fontSize: 11, color: w(item.id) ? BRAND : DARK.textDim,
                display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
              }}
            >
              {w(item.id) ? <Eye size={11} /> : <EyeOff size={11} />}
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className={s.createForm}>
          <div className={s.createFormRow}>
            <input autoFocus placeholder={t('dashboard.projectNamePlaceholder')} value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && createMut.mutate()}
              className={`${s.inputField} ${s.inputName}`} />
            <input placeholder={t('dashboard.descriptionPlaceholder')} value={desc}
              onChange={e => setDesc(e.target.value)}
              className={`${s.inputField} ${s.inputDesc}`} />
            <button onClick={() => setShowForm(false)} className={s.cancelBtn}>{t('cancel')}</button>
            <button disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}
              className={s.createBtn}
              style={{ opacity: !name.trim() ? 0.45 : 1 }}>
              {createMut.isPending ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      )}

      {/* Stat cards */}
      {w('stat-cards') && !isLoading && projects.length > 0 && (
        <StatCards projects={projects} activities={activities} />
      )}

      {/* Tab bar */}
      <div className={s.tabBar}>
        {[
          { key: 'projects', label: t('nav.projects'), icon: <FolderOpen size={13} /> },
          { key: 'progress', label: t('dashboard.progress'), icon: <TrendingUp size={13} /> },
          { key: 'health',   label: t('dashboard.health'),   icon: <Shield size={13} /> },
          { key: 'tasks',    label: t('dashboard.myWork'),   icon: <ListChecks size={13} /> },
          { key: 'compare',  label: t('dashboard.compare'),  icon: <GitCompare size={13} /> },
          { key: 'mywork',   label: t('dashboard.myWork'),   icon: <User size={13} /> },
          { key: 'charts',   label: t('dashboard.charts'),   icon: <BarChart2 size={13} /> },
        ].map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
            className={`${s.tabBtn} ${tab === tabItem.key ? s.tabBtnActive : s.tabBtnInactive}`}>
            {tabItem.icon}{tabItem.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`${s.contentArea} ${isMobile ? s.contentPadMobile : s.contentPadDesktop}`}>
        {isLoading ? (
          <div className={s.loadingWrap}>
            <div className={s.loadingSpinner} />
            {t('loading')}
          </div>
        ) : tab === 'progress' ? (
          <ViewProgress projects={active} pinned={pinned} onTogglePin={handleTogglePin} />
        ) : tab === 'health' ? (
          <ViewHealth projects={active} pinned={pinned} onTogglePin={handleTogglePin} />
        ) : tab === 'tasks' ? (
          <ViewTasks projects={active} />
        ) : tab === 'compare' ? (
          <ViewCompare projects={active} />
        ) : tab === 'charts' ? (
          <IdentityChartsView
            data={hubStats}
            selectedIdentityId={chartIdentityId}
            onSelectIdentity={setChartIdentityId}
            onNavigate={(projectId) => navigate(`/projects/${projectId}`)}
          />
        ) : tab === 'mywork' ? (
          <div className={`${s.myWorkGrid} ${isMobile ? s.myWorkGridMobile : s.myWorkGridDesktop}`}>
            <div>
              <div className={s.sectionHeader}>
                <User size={14} color={BRAND} />
                <h2 className={s.sectionTitle}>{t('dashboard.activeWork')}</h2>
              </div>
              <div className={s.sectionPanel}>
                <MyWorkSection projects={projects} />
              </div>
            </div>
            <div>
              <div className={s.sectionHeader}>
                <Activity size={14} color={BRAND} />
                <h2 className={s.sectionTitle}>{t('dashboard.recentActivity')}</h2>
              </div>
              <div className={s.sectionPanel}>
                <ActivityFeed activities={activities} />
              </div>
            </div>
          </div>
        ) : isEmptyState ? (
          <GettingStarted onNewProject={() => setShowForm(true)} isMobile={isMobile} />
        ) : (
          <div className={`${s.commandLayout} ${isMobile ? s.commandLayoutMobile : s.commandLayoutDesktop}`}>
            <div className={s.commandMainColumn}>
              {w('command-hero') && <CommandHero
                command={command}
                onNewProject={() => setShowForm(true)}
              />}

              {w('priority-wall') && <PriorityWall command={command} />}

              {w('agent-tasks') && <AgentTasksPanel />}

              {w('due-soon') && <DueSoonPanel projects={projects} />}

              {/* Filter buttons */}
              <div className={s.filterRow}>
                {[
                  { key: 'active',   label: t('active'),   icon: <FolderOpen size={11} />, count: active.length },
                  { key: 'archived', label: t('archived'), icon: <Archive size={11} />,    count: archived.length },
                  { key: 'all',      label: t('all'),      icon: null,                     count: projects.length },
                ].map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`${s.filterBtn} ${filter === f.key ? s.filterBtnActive : s.filterBtnInactive}`}>
                    {f.icon}{f.label}
                    <span className={s.filterCount}>{f.count}</span>
                  </button>
                ))}
              </div>

              {displayed.length === 0 ? (
                <div className={s.emptyState}>
                  <FolderOpen size={36} className={s.emptyIcon} />
                  <p className={s.emptyTitle}>{t('dashboard.noProjectsEmpty')}</p>
                  <p className={s.emptySubtitle}>{t('dashboard.createFirstProject')}</p>
                </div>
              ) : (
                <div className={`${s.projectGrid} ${isMobile ? s.projectGridMobile : s.projectGridDesktop}`}>
                  {displayed.map((p, i) => (
                    <ProjectCard key={p.id} project={p} index={i} onDelete={id => deleteMut.mutate(id)} />
                  ))}
                </div>
              )}
            </div>
            {w('ops-sidebar') && <OpsSidebar command={command} />}
          </div>
        )}
      </div>
    </div>
  )
}
