import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderOpen, Archive, User, Activity, BarChart2, TrendingUp, Shield, ListChecks, GitCompare, Settings, Eye, EyeOff } from 'lucide-react'
import { getProjects, createProject, deleteProject, getActivity, getIdentityHubStats, getGoals, getDecisions, getPreference, setPreference } from '../api/client'
import AgentTasksPanel from '../components/AgentTasksPanel'
import IdentityChartsView from '../components/IdentityChartsView'
import { ViewProgress, ViewHealth, ViewTasks, ViewCompare, getPinnedIds, togglePin } from '../components/OverviewViews'
import ProjectCard from '../components/dashboard/ProjectCard'
import ActivityFeed from '../components/dashboard/ActivityFeed'
import { CommandHero, PriorityWall, OpsSidebar } from '../components/dashboard/CommandPanels'
import StatCards from '../components/dashboard/StatCards'
import DueSoonPanel from '../components/dashboard/DueSoonPanel'
import MyWorkSection from '../components/dashboard/MyWorkSection'
import GettingStarted from '../components/dashboard/GettingStarted'
import { BRAND, DARK } from '../constants/theme'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import { deriveCommandCenter } from '../utils/commandCenter'
import { useUiPrefs } from '../utils/uiPrefs'
import useBreakpoint from '../hooks/useBreakpoint'
import s from './Dashboard.module.css'

const DEFAULT_WIDGETS = { 'stat-cards': true, 'command-hero': true, 'priority-wall': true, 'agent-tasks': true, 'due-soon': true, 'ops-sidebar': true, 'projects-grid': true }

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  useUiPrefs() // re-render on list-density / timestamp preference changes
  const { focusTarget, filterProjects, clearFocus } = useIdentityFocus()
  const { data: allProjects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const projects = filterProjects(allProjects)
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
  // `?new=project` is how the global `n` shortcut asks for the create form.
  // Consumed once, then stripped so a reload or Back does not reopen it.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('new') !== 'project') return
    setShowForm(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
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
            {focusTarget && (
              <button
                onClick={clearFocus}
                title={t('focus.clear')}
                style={{
                  marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: `${focusTarget.color}1a`, border: `1px solid ${focusTarget.color}55`,
                  borderRadius: 9999, padding: '2px 10px', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, color: focusTarget.color,
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: focusTarget.color, boxShadow: `0 0 6px ${focusTarget.color}`,
                }} />
                {t('focus.focusedOn', { name: focusTarget.name })}
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowWidgetConfig(v => !v)}
            title="Configure widgets"
            style={{
              background: showWidgetConfig ? 'rgba(var(--kt-ink-rgb), 0.1)' : 'transparent',
              border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 8,
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
                background: w(item.id) ? 'rgba(250,204,21,0.12)' : 'rgba(var(--kt-ink-rgb), 0.04)',
                border: `1px solid ${w(item.id) ? 'rgba(250,204,21,0.3)' : 'rgba(var(--kt-ink-rgb), 0.1)'}`,
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
          { key: 'tasks',    label: t('dashboard.allTasks'), icon: <ListChecks size={13} /> },
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
              {w('command-hero') && <CommandHero command={command} />}

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
                  <p className={s.emptyTitle}>{focusTarget ? t('focus.empty') : t('dashboard.noProjectsEmpty')}</p>
                  <p className={s.emptySubtitle}>{focusTarget ? t('focus.focusedOn', { name: focusTarget.name }) : t('dashboard.createFirstProject')}</p>
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
