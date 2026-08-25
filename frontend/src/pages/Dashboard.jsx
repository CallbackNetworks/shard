import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { Plus, FolderOpen, Archive, User, Activity, BarChart2, TrendingUp, Shield, ListChecks, GitCompare, Settings, Eye, EyeOff } from 'lucide-react'
import { getProjects, createProject, deleteProject, getActivity, getIdentityHubStats, getGoals, getDecisions, getPreference, setPreference, getAncestry } from '../api/client'
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
import WidgetColumn from '../components/dashboard/WidgetColumn'
import { BRAND, DARK } from '../constants/theme'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import { deriveCommandCenter } from '../utils/commandCenter'
import { groupProjectsByOwner } from '../utils/projectGroups'
import { DEFAULT_WIDGET_ORDER, normalizeWidgetOrder, reorderWidgets } from '../utils/widgetLayout'
import { useUiPrefs } from '../utils/uiPrefs'
import useBreakpoint from '../hooks/useBreakpoint'
import s from './Dashboard.module.css'

const DEFAULT_WIDGETS = { 'stat-cards': true, 'command-hero': true, 'priority-wall': true, 'agent-tasks': true, 'due-soon': true, 'ops-sidebar': true, 'projects-grid': true }
const WIDGET_CONFIG_IDS = ['stat-cards', 'command-hero', 'priority-wall', 'agent-tasks', 'due-soon', 'ops-sidebar', 'projects-grid']

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

  const { data: savedWidgetOrder } = useQuery({
    queryKey: ['preference', 'dashboard-widget-order'],
    queryFn: () => getPreference('dashboard-widget-order'),
    staleTime: 60000,
  })
  const [widgetOrder, setWidgetOrder] = useState(DEFAULT_WIDGET_ORDER)
  // Guarded like the visibility effect above, and for a sharper reason than symmetry:
  // unguarded, this runs on every identity change of the query result and always sets
  // a freshly-built object, so any consumer that hands back a new reference per render
  // turns it into a render loop. React Query's structural sharing usually hides that;
  // the page's own test mock does not, and the loop spun at 100% CPU until it was
  // killed. Absent value means "no saved order" — the default is already in state.
  useEffect(() => {
    if (savedWidgetOrder?.value) setWidgetOrder(normalizeWidgetOrder(savedWidgetOrder.value))
  }, [savedWidgetOrder])
  const widgetSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleWidgetDragEnd = useCallback((event) => {
    const { active, over } = event
    setWidgetOrder(prev => {
      const next = reorderWidgets(prev, active.id, over?.id)
      if (next !== prev) setPreference('dashboard-widget-order', next).catch(() => {})
      return next
    })
  }, [])
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
  // One request for every card on screen (ADR-0094) — asked per project this would be a
  // request per card, which is how a page ends up not asking at all.
  const { data: ancestry = {} } = useQuery({
    queryKey: ['ancestry', 'projects', allProjects.map(p => p.id).join(',')],
    queryFn: () => getAncestry(allProjects.map(p => p.id)),
    enabled: allProjects.length > 0,
    staleTime: 60000,
  })
  const projectGroups = groupProjectsByOwner(displayed, ancestry)
  // A heading that would say the same thing for every card is noise: with one group
  // (or none identified) the grid stays flat, which is also every small instance.
  const showGroups = projectGroups.length > 1
  const command = deriveCommandCenter(projects, activities, goals, decisions)

  const widgetLabels = {
    'stat-cards': t('dashboard.widgetStats'),
    'command-hero': t('dashboard.widgetOverview'),
    'priority-wall': t('dashboard.widgetPriorityLanes'),
    'agent-tasks': t('dashboard.widgetAgentTasks'),
    'due-soon': t('dashboard.widgetDueSoon'),
    'ops-sidebar': t('dashboard.widgetSignalsBriefing'),
    'projects-grid': t('dashboard.widgetProjects'),
  }
  // Only the widgets inside the two-column command layout are drag-reorderable; stat-cards
  // (page header, spans full width above the tabs) and projects-grid (the tab's own content,
  // tied to the filter buttons) stay fixed in position — still individually hide-able above.
  const widgetsById = {
    'command-hero': { label: widgetLabels['command-hero'], node: <CommandHero command={command} /> },
    'priority-wall': { label: widgetLabels['priority-wall'], node: <PriorityWall command={command} /> },
    'agent-tasks': { label: widgetLabels['agent-tasks'], node: <AgentTasksPanel /> },
    'due-soon': { label: widgetLabels['due-soon'], node: <DueSoonPanel projects={projects} /> },
    'ops-sidebar': { label: widgetLabels['ops-sidebar'], node: <OpsSidebar command={command} /> },
  }

  const projectsSection = w('projects-grid') && (
    <>
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
        projectGroups.map(group => (
          <div key={group.key} className={s.projectGroup}>
            {showGroups && (
              <div className={s.groupHeading}>
                {group.owner?.color && (
                  <span className={s.groupDot} style={{ background: group.owner.color }} />
                )}
                {group.above.length > 0 && (
                  <span className={s.groupAbove}>{group.above.map(a => a.title).join(' › ')} ›</span>
                )}
                <span className={s.groupName}>{group.owner?.title || t('dashboard.unowned')}</span>
                <span className={s.groupCount}>{group.projects.length}</span>
                <span className={s.groupLine} />
              </div>
            )}
            <div className={`${s.projectGrid} ${isMobile ? s.projectGridMobile : s.projectGridDesktop}`}>
              {group.projects.map((p, i) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  owners={ancestry[p.id]?.owners || []}
                  index={i}
                  onDelete={id => deleteMut.mutate(id)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  )

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
            title={t('dashboard.configureWidgets')}
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
          padding: '12px 16px', margin: '0 0 16px',
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: DARK.textMid, fontWeight: 600, marginRight: 8 }}>{t('dashboard.widgetsLabel')}</span>
            {WIDGET_CONFIG_IDS.map(id => (
              <button
                key={id}
                onClick={() => toggleWidget(id)}
                style={{
                  background: w(id) ? 'rgba(250,204,21,0.12)' : 'rgba(var(--kt-ink-rgb), 0.04)',
                  border: `1px solid ${w(id) ? 'rgba(250,204,21,0.3)' : 'rgba(var(--kt-ink-rgb), 0.1)'}`,
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  fontSize: 11, color: w(id) ? BRAND : DARK.textDim,
                  display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
                }}
              >
                {w(id) ? <Eye size={11} /> : <EyeOff size={11} />}
                {widgetLabels[id]}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: DARK.textDim, marginTop: 8 }}>{t('dashboard.widgetDragHint')}</div>
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
            {showWidgetConfig ? (
              <DndContext sensors={widgetSensors} collisionDetection={closestCenter} onDragEnd={handleWidgetDragEnd}>
                <div className={s.commandMainColumn}>
                  <WidgetColumn
                    colKey="main" ids={widgetOrder.main.filter(w)} widgets={widgetsById}
                    editing emptyLabel={t('dashboard.widgetColumnEmpty')}
                  />
                  {projectsSection}
                </div>
                <div className={s.commandSidebarColumn}>
                  <WidgetColumn
                    colKey="sidebar" ids={widgetOrder.sidebar.filter(w)} widgets={widgetsById}
                    editing emptyLabel={t('dashboard.widgetColumnEmpty')}
                  />
                </div>
              </DndContext>
            ) : (
              <>
                <div className={s.commandMainColumn}>
                  <WidgetColumn colKey="main" ids={widgetOrder.main.filter(w)} widgets={widgetsById} editing={false} />
                  {projectsSection}
                </div>
                <div className={s.commandSidebarColumn}>
                  <WidgetColumn colKey="sidebar" ids={widgetOrder.sidebar.filter(w)} widgets={widgetsById} editing={false} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
