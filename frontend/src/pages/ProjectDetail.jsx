import { useState, useDeferredValue } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Tag, Zap, X, SlidersHorizontal, Bot, Download, Upload, CheckSquare, Bookmark, Rss, Check, Share2, MessageSquare, RefreshCw } from 'lucide-react'
import {
  getProject, createTask, updateTask, deleteTask, updateProject, rotateIcalToken,
  createLabel, deleteLabel, addLabelToTask,
  createCycle, updateCycle, deleteCycle, addTaskToCycle, removeTaskFromCycle,
  reorderTasks,
  bulkUpdateTasks, exportTasks, importTasks,
  getSavedFilters, createSavedFilter,
} from '../api/client'
import IssueRow from '../components/IssueRow'
import GanttChart from '../components/GanttChart'
import BoardView from '../components/BoardView'
import CalendarView from '../components/CalendarView'
import TableView from '../components/TableView'
import TaskCreateForm from '../components/TaskCreateForm'
import CyclePanel from '../components/CyclePanel'
import { BRAND, DARK, LABEL_PALETTE } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import { getUiPrefs } from '../utils/uiPrefs'
import s from './ProjectDetail.module.css'

function LabelChip({ label, onRemove }) {
  return (
    <span className={s.labelChip} style={{
      background: label.color + '22', color: label.color,
      border: `1px solid ${label.color}44`,
    }}>
      {label.name}
      {onRemove && (
        <button onClick={onRemove} className={s.labelChipRemoveBtn} style={{ color: label.color }}>
          <X size={10} />
        </button>
      )}
    </span>
  )
}

function LabelManager({ labels, onCreateLabel, onDeleteLabel }) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_PALETTE[0])
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={s.labelManagerToggle}
      >
        <Tag size={12} /> Labels ({labels.length})
      </button>
      {open && (
        <div className={s.labelManagerDropdown}>
          <div className={s.labelManagerTitle}>Project Labels</div>
          {labels.length === 0 && (
            <div className={s.labelManagerEmpty}>No labels yet.</div>
          )}
          <div className={s.labelManagerList}>
            {labels.map(lb => (
              <span key={lb.id} className={s.labelManagerLabelChip} style={{
                background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
              }}>
                {lb.name}
                <button onClick={() => onDeleteLabel(lb.id)} className={s.labelManagerDeleteBtn} style={{ color: lb.color }}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className={s.labelManagerNewLabel}>New label</div>
          <div className={s.labelManagerInputRow}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Label name"
              className={s.labelManagerInput}
            />
          </div>
          <div className={s.labelManagerPalette}>
            {LABEL_PALETTE.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={s.labelManagerColorBtn}
                style={{
                  background: c,
                  outline: newColor === c ? `2px solid ${c}` : '2px solid transparent',
                }}
              />
            ))}
          </div>
          <button
            disabled={!newName.trim()}
            onClick={() => { if (newName.trim()) { onCreateLabel({ name: newName.trim(), color: newColor }); setNewName('') } }}
            className={s.labelManagerCreateBtn}
            style={{ opacity: newName.trim() ? 1 : 0.5 }}
          >
            Create Label
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const uiPrefs = getUiPrefs()
  const [tab, setTab] = useState(uiPrefs.defaultView)
  const [filter, setFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterLabel, setFilterLabel] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [filterDue, setFilterDue] = useState('all')
  const [filterAgent, setFilterAgent] = useState('all')
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
  const [copiedIcal, setCopiedIcal] = useState(false)
  const [copiedShare, setCopiedShare] = useState(false)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
  })

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

  const guestNotesMut = useMutation({
    mutationFn: () => updateProject(id, { allow_guest_notes: !project.allow_guest_notes }),
    onSuccess: invalidate,
  })

  const rotateIcalMut = useMutation({
    mutationFn: () => rotateIcalToken(id),
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

  const applyFilters = (list) => {
    let result = list
    if (filter !== 'all') result = result.filter(t => t.status === filter)
    if (filterPriority !== 'all') result = result.filter(t => t.priority === filterPriority)
    if (filterLabel !== 'all') result = result.filter(t => (t.labels || []).some(l => l.id === filterLabel))
    if (filterAssignee !== 'all') result = result.filter(t => t.assignee === filterAssignee)
    if (filterAgent !== 'all') result = result.filter(t => t.assigned_agent_name === filterAgent)
    if (filterDue === 'overdue') result = result.filter(t => t.due_date && new Date(t.due_date) < new Date())
    else if (filterDue === 'this_week') {
      const now = new Date(); const end = new Date(); end.setDate(now.getDate() + 7)
      result = result.filter(t => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= end)
    } else if (filterDue === 'no_date') result = result.filter(t => !t.due_date)
    return result
  }

  const activeFilterCount = [filterPriority, filterLabel, filterAssignee, filterDue, filterAgent].filter(f => f !== 'all').length

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

  const openQuickAdd = () => {
    setShowForm(true)
    setTab('issues')
  }

  if (isLoading) return (
    <div className={s.loadingWrapper}>
      <div className={s.loadingSpinner} />
      Loading…
    </div>
  )

  if (!project) return <div className={s.notFound}>Project not found</div>

  const identColor = project.identities?.[0]?.color || BRAND

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
              <div className={s.progressBarTrack}>
                <div className={s.progressBarFill} style={{ width: `${project.progress}%` }} />
              </div>
            </div>
            <button
              onClick={() => {
                if (!project.ical_token) return
                const url = `${window.location.origin}/ical/${project.ical_token}.ics`
                navigator.clipboard.writeText(url)
                setCopiedIcal(true)
                setTimeout(() => setCopiedIcal(false), 2000)
              }}
              disabled={!project.ical_token}
              className={s.archiveBtn}
              title="Copy iCal subscribe URL"
            >
              {copiedIcal ? <Check size={12} /> : <Rss size={12} />}
              {copiedIcal ? 'Copied!' : 'iCal'}
            </button>
            <button
              onClick={() => {
                if (window.confirm('Generate a new iCal link? Existing calendar subscriptions will stop updating.')) {
                  rotateIcalMut.mutate()
                }
              }}
              disabled={!project.ical_token || rotateIcalMut.isPending}
              className={s.archiveBtn}
              title="Revoke and regenerate the iCal link (does not affect the share link)"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => {
                if (!project.share_token) return
                const url = `${window.location.origin}/share/p/${project.share_token}`
                navigator.clipboard.writeText(url)
                setCopiedShare(true)
                setTimeout(() => setCopiedShare(false), 2000)
              }}
              disabled={!project.share_token}
              className={s.archiveBtn}
              title="Copy public project share URL"
            >
              {copiedShare ? <Check size={12} /> : <Share2 size={12} />}
              {copiedShare ? 'Copied!' : 'Share'}
            </button>
            <button
              onClick={() => guestNotesMut.mutate()}
              className={s.archiveBtn}
              style={project.allow_guest_notes ? { color: '#818cf8', borderColor: 'rgba(129,140,248,0.4)' } : undefined}
              title={project.allow_guest_notes ? 'Guest notes enabled on share page — click to disable' : 'Allow share-page visitors to leave notes'}
            >
              <MessageSquare size={12} />
              Notes
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

        {/* Issues */}
        {tab === 'issues' && (
          <div>
            <div className={s.filterBar}>
              {!searchQ && ['all', 'todo', 'in_progress', 'done', 'failed'].map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`${s.filterBtn} ${filter === f ? s.filterBtnActive : s.filterBtnInactive}`}>
                  {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                  {' '}<span className={s.filterCount}>{f === 'all' ? topTasks.length : topTasks.filter(t => t.status === f).length}</span>
                </button>
              ))}
              <div className={s.filterRight}>
                {/* Saved filters dropdown */}
                {savedFilters.length > 0 && (
                  <select
                    onChange={e => {
                      const sf = savedFilters.find(f => f.id === e.target.value)
                      if (!sf) return
                      const fl = sf.filters || {}
                      setFilter(fl.status || 'all')
                      setFilterPriority(fl.priority || 'all')
                      setFilterLabel(fl.label_id || 'all')
                      setFilterAssignee(fl.assignee || 'all')
                      setFilterDue(fl.due || 'all')
                      setShowFilters(true)
                    }}
                    style={{ fontSize: 11, background: DARK.elevated, color: DARK.textMid, border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
                    value=""
                  >
                    <option value="">Saved views</option>
                    {savedFilters.map(sf => (
                      <option key={sf.id} value={sf.id}>{sf.name}</option>
                    ))}
                  </select>
                )}
                {/* Save current filter */}
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      const name = prompt('Name for this saved view:')
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
                        },
                      })
                    }}
                    title="Save current filter"
                    style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: DARK.textMid, display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
                  >
                    <Bookmark size={11} /> Save
                  </button>
                )}
                {/* Bulk mode toggle */}
                <button
                  onClick={() => { setBulkMode(v => !v); setSelectedTasks(new Set()) }}
                  style={{
                    background: bulkMode ? 'rgba(250,204,21,0.12)' : 'none',
                    border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer',
                    color: bulkMode ? DARK.info : DARK.textMid, display: 'flex', alignItems: 'center', gap: 3, fontSize: 11,
                  }}
                >
                  <CheckSquare size={11} /> Bulk
                </button>
                {/* Export */}
                <button
                  onClick={async () => {
                    const data = await exportTasks(id, 'json')
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = `${project?.name || 'tasks'}.json`; a.click()
                    URL.revokeObjectURL(url)
                  }}
                  title="Export tasks"
                  style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: DARK.textMid, display: 'flex', alignItems: 'center' }}
                >
                  <Download size={11} />
                </button>
                {/* Import */}
                <button
                  onClick={() => setShowImport(v => !v)}
                  title="Import tasks"
                  style={{ background: showImport ? 'rgba(250,204,21,0.12)' : 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: showImport ? DARK.info : DARK.textMid, display: 'flex', alignItems: 'center' }}
                >
                  <Upload size={11} />
                </button>
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className={`${s.advancedFilterBtn} ${activeFilterCount > 0 ? s.advancedFilterActive : s.advancedFilterInactive}`}
                >
                  <SlidersHorizontal size={12} />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className={s.activeFilterBadge}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search issues\u2026"
                  className={s.searchInput}
                />
                {searchQ && (
                  <button onClick={() => setSearchQ('')} className={s.clearSearchBtn}>
                    {'\u2715'}
                  </button>
                )}
              </div>
            </div>

            {/* Advanced filter bar */}
            {showFilters && (
              <div className={s.advancedFilterBar}>
                <span className={s.advancedFilterLabel}>Filters:</span>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                  className={`${s.filterSelect} ${filterPriority !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
                  <option value="all">Priority: All</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)}
                  className={`${s.filterSelect} ${filterLabel !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
                  <option value="all">Label: All</option>
                  {labels.map(lb => <option key={lb.id} value={lb.id}>{lb.name}</option>)}
                </select>
                <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
                  className={`${s.filterSelect} ${filterAssignee !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
                  <option value="all">Assignee: All</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <select value={filterDue} onChange={e => setFilterDue(e.target.value)}
                  className={`${s.filterSelect} ${filterDue !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
                  <option value="all">Due: All</option>
                  <option value="overdue">Overdue</option>
                  <option value="this_week">This week</option>
                  <option value="no_date">No date</option>
                </select>
                {agentNames.length > 0 && (
                  <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
                    className={`${s.filterSelect} ${filterAgent !== 'all' ? s.filterSelectAgent : s.filterSelectAgentDefault}`}>
                    <option value="all">Agent: All</option>
                    {agentNames.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setFilterPriority('all'); setFilterLabel('all'); setFilterAssignee('all'); setFilterDue('all'); setFilterAgent('all') }}
                    className={s.clearAllFiltersBtn}
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            {/* Bulk action bar */}
            {bulkMode && selectedTasks.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'rgba(250,204,21,0.08)', borderBottom: '1px solid rgba(250,204,21,0.2)' }}>
                <span style={{ fontSize: 12, color: DARK.info, fontWeight: 600 }}>{selectedTasks.size} selected</span>
                <select
                  onChange={e => { if (e.target.value) { bulkUpdateMut.mutate({ task_ids: [...selectedTasks], status: e.target.value }); e.target.value = '' } }}
                  style={{ fontSize: 11, background: DARK.elevated, color: DARK.text, border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 4, padding: '3px 6px' }}
                  defaultValue=""
                >
                  <option value="" disabled>Set status...</option>
                  <option value="todo">Todo</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                  <option value="failed">Failed</option>
                </select>
                <select
                  onChange={e => { if (e.target.value) { bulkUpdateMut.mutate({ task_ids: [...selectedTasks], priority: e.target.value }); e.target.value = '' } }}
                  style={{ fontSize: 11, background: DARK.elevated, color: DARK.text, border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 4, padding: '3px 6px' }}
                  defaultValue=""
                >
                  <option value="" disabled>Set priority...</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button
                  onClick={() => bulkUpdateMut.mutate({ task_ids: [...selectedTasks], is_pinned: true })}
                  style={{ fontSize: 11, background: 'rgba(255,164,43,0.1)', color: DARK.warning, border: '1px solid rgba(255,164,43,0.3)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
                >Pin</button>
                <button
                  onClick={() => setSelectedTasks(new Set())}
                  style={{ marginLeft: 'auto', fontSize: 11, background: 'none', color: DARK.textMid, border: 'none', cursor: 'pointer' }}
                >Clear</button>
              </div>
            )}

            {/* Import modal */}
            {showImport && (
              <div style={{ padding: 16, background: 'rgba(var(--kt-ink-rgb), 0.02)', borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)' }}>
                <div style={{ fontSize: 12, color: DARK.text, fontWeight: 600, marginBottom: 8 }}>Import Tasks (JSON)</div>
                <textarea
                  value={importJson}
                  onChange={e => setImportJson(e.target.value)}
                  placeholder={'[\n  { "title": "Task 1", "priority": "high" },\n  { "title": "Task 2", "subtasks": [{ "title": "Sub 1" }] }\n]'}
                  style={{ width: '100%', minHeight: 100, background: DARK.elevated, color: DARK.text, border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, padding: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(importJson)
                        importMut.mutate({ tasks: Array.isArray(parsed) ? parsed : [parsed] })
                      } catch { alert('Invalid JSON') }
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
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Board */}
        {tab === 'board' && (
          <BoardView tasks={tasks} projectCode={projectCode} onUpdate={handleUpdate} onDelete={handleDelete} onReorder={handleReorder} wipLimits={project?.wip_limits || {}} />
        )}

        {/* Calendar */}
        {tab === 'calendar' && (
          <CalendarView tasks={tasks} onUpdateTask={(taskId, data) => handleUpdate(taskId, data)} projectId={id} />
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div>
            <div className={s.timelineHint}>
              Set <strong className={s.timelineHintStrong}>start date</strong> and <strong className={s.timelineHintStrong}>due date</strong> on issues (click ✎ in Issues tab) to see them on the timeline.
            </div>
            <GanttChart tasks={tasks} onUpdateTask={(taskId, data) => handleUpdate(taskId, data)} />
          </div>
        )}

        {/* Table */}
        {tab === 'table' && (
          <TableView tasks={tasks} projectId={id} labels={labels} cycles={cycles} onUpdate={handleUpdate} onReorder={handleReorder} />
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
