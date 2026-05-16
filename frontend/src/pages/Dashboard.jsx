import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderOpen, Archive, Clock, User, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { getProjects, createProject, deleteProject, getActivity } from '../api/client'
import AgentTasksPanel from '../components/AgentTasksPanel'
import { BRAND, STATUS_MAP, PRIORITY, DARK, SHADOW_SM, INSET_SHADOW } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

/* ── Shimmer progress bar ─────────────────────────────────────────── */
function GlowBar({ done, inProgress, failed, total }) {
  if (total === 0) return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
  )
  const pDone = (done / total) * 100
  const pProg = (inProgress / total) * 100
  const pFail = (failed / total) * 100
  return (
    <div style={{ height: 3, borderRadius: 2, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', position: 'relative' }}>
      <div style={{ display: 'flex', height: '100%', position: 'absolute', inset: 0 }}>
        {pDone > 0 && (
          <div style={{
            width: `${pDone}%`, height: '100%',
            background: STATUS_MAP.done.color,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
              animation: 'shimmerSlide 2.4s ease infinite',
            }} />
          </div>
        )}
        {pProg > 0 && <div style={{ width: `${pProg}%`, height: '100%', background: STATUS_MAP.in_progress.color, opacity: 0.8 }} />}
        {pFail > 0 && <div style={{ width: `${pFail}%`, height: '100%', background: STATUS_MAP.failed.color, opacity: 0.8 }} />}
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
      className="card-hover"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => navigate(`/app/projects/${project.id}`)}
      style={{
        background: DARK.surface,
        borderRadius: 8,
        padding: '18px 20px',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        animation: `fadeUpIn 0.35s ease forwards`,
        animationDelay: `${index * 0.055}s`,
        opacity: 0,
        boxShadow: SHADOW_SM,
      }}
    >
      {/* Subtle gradient top accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${identColor}66, transparent)`,
      }} />

      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: `linear-gradient(135deg, ${identColor}cc, ${identColor}66)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 14,
          boxShadow: `0 0 12px ${identColor}44`,
        }}>
          {project.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: DARK.text, marginBottom: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {project.name}
          </div>
          {project.description && (
            <div style={{
              fontSize: 12, color: DARK.textMid,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.description}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, padding: '2px 9px', borderRadius: 9999, fontWeight: 600, flexShrink: 0,
          background: project.status === 'archived'
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(30,215,96,0.1)',
          color: project.status === 'archived' ? DARK.textMid : '#1ed760',
          border: `1px solid ${project.status === 'archived' ? 'rgba(255,255,255,0.08)' : 'rgba(30,215,96,0.3)'}`,
          textTransform: 'capitalize', letterSpacing: '0.05em',
        }}>
          {project.status === 'archived' ? t('archived') : t('active')}
        </span>
      </div>

      {/* Progress bar */}
      <GlowBar total={project.total_tasks} done={project.done_tasks} inProgress={inProgress} failed={failed} />

      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flex: 1 }}>
          <span style={{ fontSize: 11, color: '#1ed760', fontWeight: 500 }}>
            ✓ {project.done_tasks}
          </span>
          <span style={{ fontSize: 11, color: DARK.textMid }}>
            ○ {project.total_tasks - project.done_tasks} {t('dashboard.left')}
          </span>
        </div>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: pct === 100 ? '#1ed760' : '#b3b3b3',
        }}>
          {pct}%
        </span>
        {hovered && (
          <button
            onClick={e => {
              e.stopPropagation()
              if (confirm(`Delete "${project.name}"?`)) onDelete(project.id)
            }}
            style={{
              background: 'none', border: '1px solid rgba(248,113,113,0.3)',
              cursor: 'pointer', color: '#f87171', fontSize: 11,
              padding: '2px 8px', borderRadius: 5,
              transition: 'background 0.15s',
            }}
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
  'task.created':        '#1ed760',
  'task.status_changed': '#ffa42b',
  'task.assigned':       '#539df5',
  'task.deleted':        '#f3727f',
  'project.created':     '#1ed760',
  'project.archived':    '#b3b3b3',
  'project.deleted':     '#f3727f',
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
      <div style={{ textAlign: 'center', padding: '28px 0', color: DARK.textDim, fontSize: 12 }}>
        {t('dashboard.noActivityYet')}
      </div>
    )
  }
  return (
    <div>
      {activities.map((a, i) => {
        const color = ACTION_COLORS[a.action] || DARK.textMid
        return (
          <div key={a.id || i} style={{
            display: 'flex', gap: 10, padding: '8px 0',
            borderBottom: i < activities.length - 1 ? `1px solid ${DARK.border}` : 'none',
            animation: `fadeIn 0.3s ease forwards`,
            animationDelay: `${i * 0.04}s`,
            opacity: 0,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%', background: color,
              marginTop: 7, flexShrink: 0, boxShadow: `0 0 6px ${color}88`,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: DARK.textMid, lineHeight: 1.5 }}>{a.detail}</div>
              <div style={{ fontSize: 10, color: DARK.textDim, marginTop: 2, display: 'flex', gap: 8 }}>
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
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
        background: overdue ? 'rgba(248,113,113,0.06)' : hov ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderBottom: i < total - 1 ? `1px solid ${DARK.border}` : 'none',
        borderLeft: overdue ? '2px solid #f87171' : '2px solid transparent',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0, boxShadow: `0 0 5px ${sc}66` }} />
      <span style={{ fontSize: 11, color: pc, flexShrink: 0, width: 10 }}>
        {PRIORITY[task.priority]?.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: task.status === 'done' ? DARK.textDim : DARK.textMid,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>
      </div>
      <span style={{ fontSize: 10, color: DARK.textDim, flexShrink: 0 }}>{task.projectName}</span>
      {task.due_date && (
        <span style={{
          fontSize: 10, color: overdue ? '#f87171' : DARK.textDim,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
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
    <svg width={80} height={24} style={{ display: 'block', marginTop: 6 }}>
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
      color: '#ffffff',
      delay: 0,
    },
    {
      label: t('dashboard.completedToday'),
      value: completedToday,
      color: '#1ed760',
      delay: 0.06,
    },
    {
      label: t('dashboard.overdueCount'),
      value: overdueTasks,
      color: overdueTasks > 0 ? '#f87171' : '#ffffff',
      delay: 0.12,
    },
    {
      label: t('dashboard.completionRate'),
      value: `${completionRate}%`,
      color: completionRate === 100 ? BRAND : '#ffffff',
      delay: 0.18,
      sparkline: true,
    },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 10,
      padding: '0 24px 16px',
    }}>
      {cards.map((card, idx) => (
        <div
          key={idx}
          style={{
            background: DARK.surface,
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '14px 16px',
            animation: 'fadeUpIn 0.35s ease forwards',
            animationDelay: `${card.delay}s`,
            opacity: 0,
          }}
        >
          <div style={{ fontSize: 11, color: DARK.textDim, marginBottom: 4 }}>{card.label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
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

  if (dueSoonTasks.length === 0) return null

  return (
    <div style={{
      background: DARK.surface,
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8,
      marginBottom: 16,
      overflow: 'hidden',
      animation: 'fadeUpIn 0.3s ease forwards',
      animationDelay: '0.1s',
      opacity: 0,
    }}>
      <button
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '10px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: DARK.textMid,
        }}
      >
        <Clock size={13} color="#ffa42b" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', flex: 1, textAlign: 'left' }}>
          {t('dashboard.dueSoon')}
        </span>
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 9999, fontWeight: 700,
          background: 'rgba(255,164,43,0.15)', color: '#ffa42b',
          border: '1px solid rgba(255,164,43,0.3)',
        }}>
          {dueSoonTasks.length}
        </span>
        {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>

      {!collapsed && (
        <div style={{ maxHeight: 180, overflowY: 'auto', padding: '0 4px 8px' }}>
          {dueSoonTasks.map((task, i) => (
            <TaskRow
              key={task.id}
              t={task}
              i={i}
              total={dueSoonTasks.length}
              onClick={() => navigate(`/app/projects/${task.projectId}`)}
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
  const visibleTasks = showAll ? tasks : tasks.slice(0, 8)

  return (
    <div style={{
      borderLeft: `3px solid ${ident.color}`,
      paddingLeft: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 5, background: ident.color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: '#fff', fontWeight: 800,
          boxShadow: `0 0 8px ${ident.color}66`,
        }}>
          {ident.avatar || ident.name.charAt(0)}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: ident.color }}>{ident.name}</span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 9999, fontWeight: 700,
          background: `${ident.color}22`, color: ident.color,
        }}>
          {tasks.filter(task => task.status !== 'done').length}
        </span>
        <span style={{ fontSize: 10, color: DARK.textDim }}>
          {t('dashboard.open')}
        </span>
      </div>
      {visibleTasks.map((task, i) => (
        <TaskRow key={task.id + ident.id} t={task} i={i} total={visibleTasks.length}
          onClick={() => navigate(`/app/projects/${task.projectId}`)} />
      ))}
      {tasks.length > 8 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: BRAND, fontSize: 11, padding: '4px 10px', marginTop: 4,
          }}
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
      <div style={{ textAlign: 'center', padding: '20px 0', color: DARK.textDim, fontSize: 12 }}>
        {t('dashboard.noActiveTasks')}
      </div>
    )
  }

  const hasIdentities = identityGroups.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {identityGroups.map(({ identity: ident, tasks }) => (
        <IdentityGroup key={ident.id} ident={ident} tasks={tasks} navigate={navigate} />
      ))}
      {ungroupedTasks.length > 0 && (
        <div>
          {hasIdentities && (
            <div style={{ fontSize: 11, fontWeight: 600, color: DARK.textDim, marginBottom: 8 }}>{t('dashboard.other')}</div>
          )}
          {ungroupedTasks.slice(0, 8).map((task, i) => (
            <TaskRow key={task.id} t={task} i={i} total={Math.min(ungroupedTasks.length, 8)}
              onClick={() => navigate(`/app/projects/${task.projectId}`)} />
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
      gradient: 'linear-gradient(135deg, #818cf8, #4f46e5)',
      action: <button
        onClick={onNewProject}
        style={{
          marginTop: 10, padding: '7px 16px', border: 'none', borderRadius: 9999,
          background: BRAND, color: '#000', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px',
        }}
      >
        <Plus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        {t('dashboard.newProject')}
      </button>,
    },
    {
      num: 2,
      title: t('dashboard.step2Title'),
      desc: t('dashboard.step2Desc'),
      gradient: 'linear-gradient(135deg, #1ed760, #059669)',
    },
    {
      num: 3,
      title: t('dashboard.step3Title'),
      desc: t('dashboard.step3Desc'),
      gradient: 'linear-gradient(135deg, #ffa42b, #d97706)',
    },
    {
      num: 4,
      title: t('dashboard.step4Title'),
      desc: t('dashboard.step4Desc'),
      gradient: 'linear-gradient(135deg, #f87171, #dc2626)',
    },
  ]

  return (
    <div style={{ animation: 'fadeIn 0.4s ease', padding: '20px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', marginBottom: 6 }}>
          {t('dashboard.gettingStarted')}
        </div>
        <div style={{ fontSize: 13, color: DARK.textMid }}>{t('dashboard.createFirstProject')}</div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)',
        gap: 14,
      }}>
        {steps.map((step, i) => (
          <div
            key={step.num}
            style={{
              background: DARK.surface,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              padding: '20px 16px',
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${i * 0.08}s`,
              opacity: 0,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: step.gradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, color: '#fff',
              marginBottom: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              {step.num}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', marginBottom: 6 }}>{step.title}</div>
            <div style={{ fontSize: 12, color: DARK.textMid, lineHeight: 1.5 }}>{step.desc}</div>
            {step.action}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Input style helper ───────────────────────────────────────────── */
const inputStyle = {
  background: '#1f1f1f',
  border: 'none',
  borderRadius: 4,
  padding: '10px 14px',
  fontSize: 14,
  color: '#ffffff',
  outline: 'none',
  boxShadow: INSET_SHADOW,
}

/* ── Dashboard ────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const { data: activities = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => getActivity({ limit: 50 }),
    staleTime: 10000,
  })
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('active')
  const [tab, setTab] = useState('projects')

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

  // Time-of-day greeting
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('dashboard.goodMorning')
    : hour < 18
    ? t('dashboard.goodAfternoon')
    : t('dashboard.goodEvening')

  const tabStyle = (key) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '10px 16px', border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 14, fontWeight: tab === key ? 700 : 400,
    color: tab === key ? '#ffffff' : DARK.textMid,
    borderBottom: tab === key ? `2px solid ${BRAND}` : '2px solid transparent',
    marginBottom: -1, transition: 'color 0.15s',
  })

  const filterBtn = (key) => ({
    btn: {
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '6px 16px', borderRadius: 9999, cursor: 'pointer', fontSize: 13, fontWeight: filter === key ? 700 : 400,
      background: filter === key ? '#1f1f1f' : 'transparent',
      border: filter === key ? 'none' : '1px solid rgba(255,255,255,0.15)',
      color: filter === key ? '#ffffff' : DARK.textMid,
      transition: 'all 0.15s',
    },
  })

  const isEmptyState = projects.length === 0 && activities.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: DARK.bg, color: DARK.text }}>
      {/* Header */}
      <div style={{
        padding: '18px 24px', borderBottom: `1px solid ${DARK.border}`,
        display: 'flex', alignItems: 'center', gap: 16,
        background: 'rgba(255,255,255,0.015)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: DARK.textMid, marginBottom: 2 }}>{greeting}</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#ffffff' }}>{t('dashboard.title')}</h1>
          <div style={{ fontSize: 12, color: DARK.textDim, marginTop: 2 }}>
            <span style={{ color: '#1ed760', fontWeight: 600 }}>{active.length}</span> {t('active')} ·{' '}
            <span style={{ color: DARK.textMid }}>{archived.length}</span> {t('archived')}
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 24px', borderRadius: 9999, border: 'none',
            background: BRAND,
            color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '1.4px',
            boxShadow: 'rgba(0,0,0,0.3) 0px 4px 8px',
            transition: 'transform 0.1s, background 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.background = '#1fdf64' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = BRAND }}
        >
          <Plus size={14} /> {t('dashboard.newProject')}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{
          padding: '12px 24px',
          background: 'rgba(255,255,255,0.025)',
          borderBottom: `1px solid ${DARK.border}`,
          animation: 'fadeUpIn 0.2s ease forwards',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input autoFocus placeholder={t('dashboard.projectNamePlaceholder')} value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && createMut.mutate()}
              style={{ ...inputStyle, flex: '1 1 200px' }} />
            <input placeholder={t('dashboard.descriptionPlaceholder')} value={desc}
              onChange={e => setDesc(e.target.value)}
              style={{ ...inputStyle, flex: '2 1 280px' }} />
            <button onClick={() => setShowForm(false)} style={{
              padding: '8px 20px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999,
              background: 'transparent', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#ffffff',
              textTransform: 'uppercase', letterSpacing: '1.4px',
            }}>{t('cancel')}</button>
            <button disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()} style={{
              padding: '8px 22px', border: 'none', borderRadius: 9999,
              background: BRAND, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              opacity: !name.trim() ? 0.45 : 1, transition: 'opacity 0.15s',
              textTransform: 'uppercase', letterSpacing: '1.4px',
            }}>
              {createMut.isPending ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      )}

      {/* Stat cards (always visible, all tabs) */}
      {!isLoading && projects.length > 0 && (
        <StatCards projects={projects} activities={activities} />
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, padding: '0 24px', borderBottom: `1px solid ${DARK.border}` }}>
        {[
          { key: 'projects', label: t('nav.projects'), icon: <FolderOpen size={13} /> },
          { key: 'mywork',   label: t('dashboard.myWork'),  icon: <User size={13} /> },
        ].map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key)} style={tabStyle(tabItem.key)}>
            {tabItem.icon}{tabItem.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 12 : 24 }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: DARK.textMid }}>
            <div style={{ width: 18, height: 18, border: `2px solid ${BRAND}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 10, flexShrink: 0 }} />
            {t('loading')}
          </div>
        ) : tab === 'mywork' ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: 24, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <User size={14} color={BRAND} />
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#ffffff' }}>{t('dashboard.activeWork')}</h2>
              </div>
              <div style={{ background: DARK.surface, borderRadius: 8, padding: '12px 14px', boxShadow: SHADOW_SM }}>
                <MyWorkSection projects={projects} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Activity size={14} color={BRAND} />
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#ffffff' }}>{t('dashboard.recentActivity')}</h2>
              </div>
              <div style={{ background: DARK.surface, borderRadius: 8, padding: '12px 14px', boxShadow: SHADOW_SM }}>
                <ActivityFeed activities={activities} />
              </div>
            </div>
          </div>
        ) : isEmptyState ? (
          <GettingStarted onNewProject={() => setShowForm(true)} isMobile={isMobile} />
        ) : (
          <>
            {/* Agent Workload panel */}
            <AgentTasksPanel />

            {/* Due Soon panel */}
            <DueSoonPanel projects={projects} />

            {/* Filter buttons */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {[
                { key: 'active',   label: t('active'),   icon: <FolderOpen size={11} />, count: active.length },
                { key: 'archived', label: t('archived'), icon: <Archive size={11} />,    count: archived.length },
                { key: 'all',      label: t('all'),      icon: null,                     count: projects.length },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)} style={filterBtn(f.key).btn}>
                  {f.icon}{f.label}
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{f.count}</span>
                </button>
              ))}
            </div>

            {displayed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: DARK.textDim, animation: 'fadeIn 0.4s ease' }}>
                <FolderOpen size={36} style={{ margin: '0 auto 14px', opacity: 0.3, display: 'block', color: BRAND }} />
                <p style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{t('dashboard.noProjectsEmpty')}</p>
                <p style={{ marginTop: 6, fontSize: 13 }}>{t('dashboard.createFirstProject')}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {displayed.map((p, i) => (
                  <ProjectCard key={p.id} project={p} index={i} onDelete={id => deleteMut.mutate(id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
