import { useState, useEffect, useCallback, useDeferredValue } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Zap, Bot, Share2, Webhook } from 'lucide-react'
import {
  getProject, createTask, updateTask, deleteTask, updateProject,
  createLabel, deleteLabel, addLabelToTask,
  createCycle, updateCycle, deleteCycle, addTaskToCycle, removeTaskFromCycle,
  reorderTasks,
  bulkUpdateTasks, exportTasks, importTasks,
  getSavedFilters, createSavedFilter,
} from '../api/client'
import IssueRow from '../components/IssueRow'
import LabelManager, { LabelChip } from '../components/project/LabelManager'
import TaskFiltersPanel from '../components/project/TaskFiltersPanel'
import BulkToolbar from '../components/project/BulkToolbar'
import NodeShareFacet from '../components/NodeShareFacet'
import WebhookPanel from '../components/WebhookPanel'
import BuildHistoryPanel from '../components/BuildHistoryPanel'
import ChildContainersPanel from '../components/ChildContainersPanel'
import GanttChart from '../components/GanttChart'
import BoardView from '../components/BoardView'
import CalendarView from '../components/CalendarView'
import TableView from '../components/TableView'
import TaskCreateForm from '../components/TaskCreateForm'
import CyclePanel from '../components/CyclePanel'
import { BRAND, DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import { getUiPrefs } from '../utils/uiPrefs'
import { touchProject } from '../utils/recentProjects'
import { filterTasks } from '../utils/taskFilters'
import s from './ProjectDetail.module.css'

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const uiPrefs = getUiPrefs()

  // Which view you are on and what you have filtered to is where you are, not
  // private component state: it belongs in the URL so it survives a reload,
  // comes back with Back, and can be handed to someone else. uiPrefs.defaultView
  // is the fallback when the URL says nothing — a default, not the truth.
  const [searchParams, setSearchParams] = useSearchParams()
  const param = (key, fallback = 'all') => searchParams.get(key) || fallback

  const tab = param('tab', uiPrefs.defaultView)
  const filter = param('status')
  const filterPriority = param('priority')
  const filterLabel = param('label')
  const filterAssignee = param('assignee')
  const filterDue = param('due')
  const filterAgent = param('agent')
  const searchQ = param('q', '')

  // `all` and `''` are the absence of a filter, so they are dropped rather than
  // written — the URL stays readable and only carries what is actually set.
  const patchParams = useCallback((patch, { replace = true } = {}) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '' || value === 'all') next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace })
  }, [setSearchParams])

  // Switching view is a navigation, so it pushes; adjusting a filter replaces,
  // otherwise Back would walk one keystroke at a time.
  const setTab = useCallback((next) => patchParams({ tab: next }, { replace: false }), [patchParams])
  const setSearchQ = useCallback((next) => patchParams({ q: next }), [patchParams])

  const [showFilters, setShowFilters] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newTask, setNewTask] = useState({
    title: '', description: '', priority: uiPrefs.defaultPriority, status: 'todo', assignee: '', start_date: '', due_date: '',
    selectedLabels: [],
  })
  const [showCycleForm, setShowCycleForm] = useState(false)
  const [newCycle, setNewCycle] = useState({ name: '', description: '', status: 'draft', start_date: '', end_date: '' })
  const [showAgentInstr, setShowAgentInstr] = useState(false)
  const [agentInstr, setAgentInstr] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [agentInstrDirty, setAgentInstrDirty] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedTasks, setSelectedTasks] = useState(new Set())
  const [showImport, setShowImport] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState('')
  const [shareSettingsOpen, setShareSettingsOpen] = useState(false)
  const [cicdOpen, setCicdOpen] = useState(false)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
  })

  // Feeds the palette's recency order (ADR-0067). Keyed on the loaded project,
  // not the route param, so a bad id never enters the switcher.
  useEffect(() => { if (project?.id) touchProject(project.id) }, [project?.id])

  const tasks = project?.tasks || []
  const labels = project?.labels || []
  const cycles = project?.cycles || []
  const topTasks = tasks.filter(t => t.parent_id == null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project', id] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const createMut = useMutation({
    mutationFn: async (data) => {
      const { selectedLabels, ...rest } = data
      const payload = { ...rest }
      if (!payload.start_date) delete payload.start_date
      else payload.start_date = new Date(payload.start_date).toISOString()
      if (!payload.due_date) delete payload.due_date
      else payload.due_date = new Date(payload.due_date).toISOString()
      if (!payload.description) delete payload.description
      if (!payload.assignee) delete payload.assignee
      const task = await createTask(id, payload)
      for (const labelId of (selectedLabels || [])) {
        await addLabelToTask(id, task.id, labelId)
      }
      return task
    },
    onSuccess: () => {
      invalidate()
      setShowForm(false)
      setNewTask({ title: '', description: '', priority: getUiPrefs().defaultPriority, status: 'todo', assignee: '', start_date: '', due_date: '', selectedLabels: [] })
    },
  })

  const createSubtaskMut = useMutation({
    mutationFn: ({ parentId, title }) => createTask(id, { title, priority: 'medium', parent_id: parentId }),
    onSuccess: invalidate,
  })

  const updateMut = useMutation({
    mutationFn: ({ taskId, data }) => updateTask(id, taskId, data),
    onSuccess: invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: (taskId) => deleteTask(id, taskId),
    onSuccess: invalidate,
  })

  const archiveMut = useMutation({
    mutationFn: () => updateProject(id, { status: project.status === 'archived' ? 'active' : 'archived' }),
    onSuccess: invalidate,
  })

  const saveAgentInstrMut = useMutation({
    mutationFn: () => updateProject(id, { agent_instructions: agentInstr || null, repo_url: repoUrl || null }),
    onSuccess: () => { invalidate(); setAgentInstrDirty(false) },
  })

  const createLabelMut = useMutation({
    mutationFn: (data) => createLabel(id, data),
    onSuccess: invalidate,
  })

  const deleteLabelMut = useMutation({
    mutationFn: (labelId) => deleteLabel(id, labelId),
    onSuccess: invalidate,
  })

  const createCycleMut = useMutation({
    mutationFn: (data) => createCycle(id, data),
    onSuccess: () => { invalidate(); setShowCycleForm(false); setNewCycle({ name: '', description: '', status: 'draft', start_date: '', end_date: '' }) },
  })

  const updateCycleMut = useMutation({
    mutationFn: ({ cycleId, data }) => updateCycle(id, cycleId, data),
    onSuccess: invalidate,
  })

  const deleteCycleMut = useMutation({
    mutationFn: (cycleId) => deleteCycle(id, cycleId),
    onSuccess: invalidate,
  })

  const addTaskToCycleMut = useMutation({
    mutationFn: ({ cycleId, taskId }) => addTaskToCycle(id, cycleId, taskId),
    onSuccess: invalidate,
  })

  const removeTaskFromCycleMut = useMutation({
    mutationFn: ({ cycleId, taskId }) => removeTaskFromCycle(id, cycleId, taskId),
    onSuccess: invalidate,
  })

  const reorderMut = useMutation({
    mutationFn: (taskIds) => reorderTasks(id, taskIds),
    onSuccess: invalidate,
  })

  const bulkUpdateMut = useMutation({
    mutationFn: (data) => bulkUpdateTasks(id, data),
    onSuccess: () => { invalidate(); setSelectedTasks(new Set()); setBulkMode(false) },
  })

  const importMut = useMutation({
    mutationFn: (data) => importTasks(id, data),
    onSuccess: () => { invalidate(); setShowImport(false); setImportJson('') },
  })

  const { data: savedFilters = [] } = useQuery({
    queryKey: ['saved-filters', id],
    queryFn: () => getSavedFilters(id),
  })

  const saveFilterMut = useMutation({
    mutationFn: (data) => createSavedFilter(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-filters', id] }),
  })

  const handleUpdate = (taskId, data) => updateMut.mutate({ taskId, data })
  const handleDelete = (taskId) => deleteMut.mutate(taskId)
  const handleCreateSubtask = (parentId, title) => createSubtaskMut.mutate({ parentId, title })
  const handleReorder = (taskIds) => reorderMut.mutate(taskIds)

  const projectCode = project?.name?.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TSK'
  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort()

  const agentNames = [...new Set(tasks.map(t => t.assigned_agent_name).filter(Boolean))].sort()

  const applyFilters = (list) => filterTasks(list, {
    status: filter,
    priority: filterPriority,
    label: filterLabel,
    assignee: filterAssignee,
    agent: filterAgent,
    due: filterDue,
  })

  const activeFilterCount = [filterPriority, filterLabel, filterAssignee, filterDue, filterAgent].filter(f => f !== 'all').length

  const applyFilterPatch = (patch) => patchParams(patch)

  const applySavedFilter = (filterId) => {
    const sf = savedFilters.find(f => f.id === filterId)
    if (!sf) return
    const fl = sf.filters || {}
    // Every axis is written, including the ones the saved view leaves empty, so
    // applying a view replaces the current filter rather than merging into it.
    patchParams({
      status: fl.status || 'all',
      priority: fl.priority || 'all',
      label: fl.label_id || 'all',
      assignee: fl.assignee || 'all',
      due: fl.due || 'all',
      agent: fl.agent || 'all',
    })
    setShowFilters(true)
  }

  const saveCurrentFilter = (name) => {
    if (!name) return
    saveFilterMut.mutate({
      name,
      project_id: id,
      filters: {
        status: filter !== 'all' ? filter : undefined,
        priority: filterPriority !== 'all' ? filterPriority : undefined,
        label_id: filterLabel !== 'all' ? filterLabel : undefined,
        assignee: filterAssignee !== 'all' ? filterAssignee : undefined,
        due: filterDue !== 'all' ? filterDue : undefined,
        // `agent` was offered as a filter but neither saved nor restored, so a
        // saved view silently dropped it.
        agent: filterAgent !== 'all' ? filterAgent : undefined,
      },
    })
  }

  const exportTasksToFile = async () => {
    const data = await exportTasks(id, 'json')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${project?.name || 'tasks'}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const deferredSearch = useDeferredValue(searchQ)
  const searchFiltered = deferredSearch.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(deferredSearch.toLowerCase())
      )
    : null
  const filteredTopTasks = searchFiltered
    ? applyFilters(searchFiltered)
    : applyFilters(topTasks)

  // The same filter applied to the full task list, for the views that draw
  // subtasks too. Board/Timeline/Calendar/Table used to receive the *unfiltered*
  // list, so switching view silently changed what you were looking at.
  const filteredTasks = applyFilters(searchFiltered || tasks)

  const openQuickAdd = useCallback(() => {
    setShowForm(true)
    setTab('issues')
  }, [setTab])

  // `?new=task` is how the global `c` shortcut (and the palette carrying that
  // intent) asks for the create form. Consumed once, then stripped.
  useEffect(() => {
    if (searchParams.get('new') !== 'task') return
    openQuickAdd()
    patchParams({ new: null })
  }, [searchParams, openQuickAdd, patchParams])

  if (isLoading) return (
    <div className={s.loadingWrapper}>
      <div className={s.loadingSpinner} />
      Loading…
    </div>
  )

  if (!project) return <div className={s.notFound}>Project not found</div>

  // The project's own colour first (ADR-0074). Falling back to a linked identity's
  // keeps every existing project looking the same, but 'first identity' is edge-creation
  // order — an arbitrary one of the two when a project has two.
  const identColor = project.color || project.identities?.[0]?.color || BRAND

  return (
    <div className={s.container}>
      {/* Header */}
      <div className={`${s.header} ${isMobile ? s.headerMobile : s.headerDesktop}`}>
        <button
          onClick={() => navigate('/')}
          className={s.backBtn}
        >
          <ArrowLeft size={12} /> My Issues
        </button>

        <div className={s.headerRow}>
          <div className={s.projectIcon} style={{
            background: `linear-gradient(135deg, ${identColor}cc, ${identColor}66)`,
            boxShadow: `0 0 14px ${identColor}44`,
          }}>
            {project.name.charAt(0).toUpperCase()}
          </div>

          <div className={s.projectInfo}>
            <div className={s.projectNameRow}>
              <h1 className={s.projectName}>{project.name}</h1>
              <span className={`${s.statusBadge} ${project.status === 'archived' ? s.statusArchived : s.statusActive}`}>
                {project.status === 'archived' ? 'Archived' : 'Active'}
              </span>
            </div>
            {project.description && (
              <p className={s.projectDescription}>{project.description}</p>
            )}
            {labels.length > 0 && (
              <div className={s.projectLabels}>
                {labels.map(lb => <LabelChip key={lb.id} label={lb} />)}
              </div>
            )}
          </div>

          <div className={s.headerActions}>
            <div className={s.progressInfo}>
              <div className={s.progressText}>{project.done_tasks}/{project.total_tasks} done</div>
              {/* Counts roll up the whole subtree (ADR-0065), so say when part of the
                  work is not on the list below — the sub-container panel names where. */}
              {project.total_tasks > project.direct_task_count && (
                <div className={s.progressNote}>
                  {project.total_tasks - project.direct_task_count} in sub-containers
                </div>
              )}
              <div className={s.progressBarTrack}>
                <div className={s.progressBarFill} style={{ width: `${project.progress}%` }} />
              </div>
            </div>
            {/* One button, one panel: link, calendar feed, PIN, expiry, guest notes and
                view count all live in the shared share panel (ADR-0073). */}
            <button
              onClick={() => setShareSettingsOpen(v => !v)}
              className={`${s.archiveBtn}${project.share_expires_at || project.share_pin_set ? ` ${s.archiveBtnActive}` : ''}`}
              title={[
                project.share_pin_set ? 'PIN protected' : null,
                project.share_expires_at ? `expires ${new Date(project.share_expires_at).toLocaleString()}` : null,
              ].filter(Boolean).join(' · ') || 'Public share link, calendar feed, PIN, expiry and guest notes'}
            >
              <Share2 size={12} />
              Share
            </button>
            <button
              onClick={() => setCicdOpen(v => !v)}
              className={`${s.archiveBtn}${cicdOpen ? ` ${s.archiveBtnActive}` : ''}`}
              title="Push and build events from this project's repo (ADR-0082)"
            >
              <Webhook size={12} />
              CI/CD
            </button>
            <LabelManager
              labels={labels}
              onCreateLabel={data => createLabelMut.mutate(data)}
              onDeleteLabel={labelId => deleteLabelMut.mutate(labelId)}
            />
            <button
              onClick={() => { setShowAgentInstr(v => !v); if (!agentInstrDirty) { setAgentInstr(project.agent_instructions || ''); setRepoUrl(project.repo_url || '') } }}
              className={`${s.agentBtn} ${showAgentInstr ? s.agentBtnActive : s.agentBtnInactive}`}
            >
              <Bot size={12} /> Agent
            </button>
            <button
              onClick={() => archiveMut.mutate()}
              className={s.archiveBtn}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              className={s.newIssueBtn}
            >
              <Plus size={13} /> New Issue
            </button>
          </div>
        </div>

        {shareSettingsOpen && (
          <NodeShareFacet node={project} subscribable invalidateKeys={[['project', id]]} />
        )}

        {cicdOpen && (
          <div className={s.agentInstrPanel}>
            <div className={s.agentInstrTitle}>CI/CD</div>
            <div className={s.agentInstrDesc}>
              Point your repo's webhooks at this project's own callback URL to see pushes and
              build results here — a project has no build outcome to apply, so every event is
              only recorded, never changes the project itself (ADR-0082).
            </div>
            <WebhookPanel taskId={project.id} />
            <div style={{ marginTop: 12 }}>
              <BuildHistoryPanel taskId={project.id} />
            </div>
          </div>
        )}

        {showAgentInstr && (
          <div className={s.agentInstrPanel}>
            <div className={s.agentInstrTitle}>
              Agent Instructions
            </div>
            <div className={s.agentInstrDesc}>
              Instructions for AI agents working on this project. Agents can read these via the API.
            </div>
            <input
              type="text"
              value={repoUrl}
              onChange={e => { setRepoUrl(e.target.value); setAgentInstrDirty(true) }}
              placeholder="Repository URL (optional), e.g. https://github.com/user/repo"
              className={s.agentInstrTextarea}
              style={{ marginBottom: 8, height: 'auto', minHeight: 'unset', padding: '8px 10px' }}
            />
            <textarea
              value={agentInstr}
              onChange={e => { setAgentInstr(e.target.value); setAgentInstrDirty(true) }}
              placeholder="e.g. Use conventional commit style for task titles. Always create subtasks for multi-step work."
              rows={4}
              className={s.agentInstrTextarea}
            />
            {agentInstrDirty && (
              <div className={s.agentInstrActions}>
                <button
                  onClick={() => saveAgentInstrMut.mutate()}
                  disabled={saveAgentInstrMut.isPending}
                  className={s.agentInstrSaveBtn}
                >
                  {saveAgentInstrMut.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setAgentInstr(project.agent_instructions || ''); setRepoUrl(project.repo_url || ''); setAgentInstrDirty(false) }}
                  className={s.agentInstrCancelBtn}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className={s.tabRow}>
          <button className={`${s.tab} ${tab === 'issues' ? s.tabActive : ''}`} onClick={() => setTab('issues')}>Issues</button>
          <button className={`${s.tab} ${tab === 'board' ? s.tabActive : ''}`} onClick={() => setTab('board')}>Board</button>
          <button className={`${s.tab} ${tab === 'timeline' ? s.tabActive : ''}`} onClick={() => setTab('timeline')}>Timeline</button>
          <button className={`${s.tab} ${tab === 'calendar' ? s.tabActive : ''}`} onClick={() => setTab('calendar')}>Calendar</button>
          <button className={`${s.tab} ${tab === 'table' ? s.tabActive : ''}`} onClick={() => setTab('table')}>Table</button>
          <button className={`${s.tab} ${tab === 'cycles' ? s.tabActive : ''}`} onClick={() => setTab('cycles')}>
            <span className={s.cycleTabContent}>
              <Zap size={12} /> Cycles
              {cycles.filter(c => c.status === 'active').length > 0 && (
                <span className={s.cycleActiveBadge}>
                  {cycles.filter(c => c.status === 'active').length}
                </span>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Containers nested under this project (ADR-0065): their tasks are counted in
          the header total but are not on this page's list. */}
      <div className={s.childContainers}>
        <ChildContainersPanel nodeId={id} />
      </div>

      {/* New issue form */}
      <TaskCreateForm
        showForm={showForm}
        newTask={newTask}
        setNewTask={setNewTask}
        createMut={createMut}
        labels={labels}
        onCancel={() => setShowForm(false)}
        projectId={id}
      />

      {/* Tab content */}
      <div className={s.tabContent}>

        {/* The filter strip belongs to the project's tasks, not to one view of
            them: it is rendered above every task tab so switching view can
            never silently drop the filter you set. Cycles are not tasks. */}
        {tab !== 'cycles' && (
          <TaskFiltersPanel
            filters={{ status: filter, priority: filterPriority, label: filterLabel, assignee: filterAssignee, due: filterDue, agent: filterAgent }}
            setFilters={applyFilterPatch}
            searchQ={searchQ}
            setSearchQ={setSearchQ}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            activeFilterCount={activeFilterCount}
            topTasks={topTasks}
            labels={labels}
            assignees={assignees}
            agentNames={agentNames}
            savedFilters={savedFilters}
            onApplySavedFilter={applySavedFilter}
            onSaveFilter={saveCurrentFilter}
            bulkMode={bulkMode}
            onToggleBulk={() => { setBulkMode(v => !v); setSelectedTasks(new Set()) }}
            // Bulk selection needs the checkbox column, which only the Issues
            // list draws — offering the toggle elsewhere would do nothing.
            showBulk={tab === 'issues'}
            onExport={exportTasksToFile}
            showImport={showImport}
            onToggleImport={() => setShowImport(v => !v)}
          />
        )}

        {/* Issues */}
        {tab === 'issues' && (
          <div>
            {/* Bulk action bar */}
            {bulkMode && selectedTasks.size > 0 && (
              <BulkToolbar
                selectedCount={selectedTasks.size}
                onSetStatus={(status) => bulkUpdateMut.mutate({ task_ids: [...selectedTasks], status })}
                onSetPriority={(priority) => bulkUpdateMut.mutate({ task_ids: [...selectedTasks], priority })}
                onPin={() => bulkUpdateMut.mutate({ task_ids: [...selectedTasks], is_pinned: true })}
                onClear={() => setSelectedTasks(new Set())}
              />
            )}

            {/* Import modal */}
            {showImport && (
              <div style={{ padding: 16, background: 'rgba(var(--kt-ink-rgb), 0.02)', borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)' }}>
                <div style={{ fontSize: 12, color: DARK.text, fontWeight: 600, marginBottom: 8 }}>Import Tasks (JSON)</div>
                <textarea
                  value={importJson}
                  onChange={e => { setImportJson(e.target.value); if (importError) setImportError('') }}
                  placeholder={'[\n  { "title": "Task 1", "priority": "high" },\n  { "title": "Task 2", "subtasks": [{ "title": "Sub 1" }] }\n]'}
                  style={{ width: '100%', minHeight: 100, background: DARK.elevated, color: DARK.text, border: `1px solid ${importError ? DARK.danger : 'rgba(var(--kt-ink-rgb), 0.1)'}`, borderRadius: 6, padding: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
                />
                {importError && (
                  <div role="alert" style={{ marginTop: 6, fontSize: 11, color: DARK.danger }}>{importError}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(importJson)
                        setImportError('')
                        importMut.mutate({ tasks: Array.isArray(parsed) ? parsed : [parsed] })
                      } catch (err) {
                        // Inline and specific: a blocking alert() saying only
                        // "Invalid JSON" does not say where the problem is.
                        setImportError(err.message)
                      }
                    }}
                    disabled={!importJson.trim() || importMut.isPending}
                    style={{ padding: '5px 14px', border: 'none', borderRadius: 9999, background: DARK.info, color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 700, opacity: importJson.trim() ? 1 : 0.5 }}
                  >
                    {importMut.isPending ? 'Importing...' : 'Import'}
                  </button>
                  <button onClick={() => setShowImport(false)} style={{ padding: '5px 14px', border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 9999, background: 'transparent', fontSize: 11, cursor: 'pointer', color: DARK.text }}>Cancel</button>
                </div>
              </div>
            )}

            {filteredTopTasks.length > 0 && (
              <div className={s.tableHeader}>
                <span className={s.colSpacer12} /><span className={s.colSpacer22} /><span className={s.colSpacer14} />
                <span className={`${s.colHeader} ${s.colHeaderId}`}>ID</span>
                <span className={`${s.colHeader} ${s.colHeaderTitle}`}>Title</span>
                <span className={`${s.colHeader} ${s.colHeaderDue}`}>Due date</span>
                <span className={`${s.colHeader} ${s.colHeaderPriority}`}>Priority</span>
                <span className={s.colSpacer88} />
              </div>
            )}

            {filteredTopTasks.length === 0 ? (
              <div className={s.emptyState}>
                {filter === 'all'
                  ? 'No issues yet. Click "+ New Issue" to create one.'
                  : `No issues with status "${filter === 'in_progress' ? 'In Progress' : filter}".`}
              </div>
            ) : (
              filteredTopTasks.map(task => (
                <div key={task.id} style={{ display: 'flex', alignItems: 'stretch' }}>
                  {bulkMode && (
                    <label style={{ display: 'flex', alignItems: 'center', paddingLeft: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={e => {
                          const next = new Set(selectedTasks)
                          e.target.checked ? next.add(task.id) : next.delete(task.id)
                          setSelectedTasks(next)
                        }}
                        style={{ accentColor: DARK.info }}
                      />
                    </label>
                  )}
                  <div style={{ flex: 1 }}>
                    <IssueRow
                      task={task}
                      projectId={id}
                      projectCode={projectCode}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onCreateSubtask={handleCreateSubtask}
                      allTasks={tasks}
                      projectLabels={labels}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Board */}
        {tab === 'board' && (
          <BoardView tasks={filteredTasks} projectCode={projectCode} onUpdate={handleUpdate} onDelete={handleDelete} onReorder={handleReorder} wipLimits={project?.wip_limits || {}} />
        )}

        {/* Calendar */}
        {tab === 'calendar' && (
          <CalendarView tasks={filteredTasks} onUpdateTask={(taskId, data) => handleUpdate(taskId, data)} projectId={id} />
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div>
            <div className={s.timelineHint}>
              Drag a bar to move it, or set <strong className={s.timelineHintStrong}>start date</strong> and{' '}
              <strong className={s.timelineHintStrong}>due date</strong> on any issue row.
            </div>
            <GanttChart tasks={filteredTasks} onUpdateTask={(taskId, data) => handleUpdate(taskId, data)} />
          </div>
        )}

        {/* Table */}
        {tab === 'table' && (
          <TableView tasks={filteredTasks} projectId={id} labels={labels} cycles={cycles} onUpdate={handleUpdate} onReorder={handleReorder} />
        )}

        {/* Cycles */}
        {tab === 'cycles' && (
          <CyclePanel
            cycles={cycles}
            tasks={tasks}
            projectId={id}
            showCycleForm={showCycleForm}
            setShowCycleForm={setShowCycleForm}
            newCycle={newCycle}
            setNewCycle={setNewCycle}
            createCycleMut={createCycleMut}
            onUpdateCycle={(cycleId, data) => updateCycleMut.mutate({ cycleId, data })}
            onDeleteCycle={(cycleId) => deleteCycleMut.mutate(cycleId)}
            onAddTask={(cycleId, taskId) => addTaskToCycleMut.mutate({ cycleId, taskId })}
            onRemoveTask={(cycleId, taskId) => removeTaskFromCycleMut.mutate({ cycleId, taskId })}
            onCyclesMutated={() => qc.invalidateQueries({ queryKey: ['project', id] })}
          />
        )}
      </div>

      {/* Floating Quick-Add button */}
      <button
        onClick={openQuickAdd}
        title="New Issue"
        className={s.fab}
      >
        <Plus size={22} />
      </button>
    </div>
  )
}
