import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Tag, Zap, X, SlidersHorizontal, Bot } from 'lucide-react'
import {
  getProject, createTask, updateTask, deleteTask, updateProject,
  createLabel, deleteLabel, addLabelToTask,
  createCycle, updateCycle, deleteCycle, addTaskToCycle, removeTaskFromCycle,
  reorderTasks,
} from '../api/client'
import IssueRow from '../components/IssueRow'
import GanttChart from '../components/GanttChart'
import BoardView from '../components/BoardView'
import TableView from '../components/TableView'
import TaskCreateForm from '../components/TaskCreateForm'
import CyclePanel from '../components/CyclePanel'
import { BRAND, LABEL_PALETTE } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
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

  const [tab, setTab] = useState('issues')
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
    title: '', description: '', priority: 'medium', status: 'todo', assignee: '', start_date: '', due_date: '',
    selectedLabels: [],
  })
  const [showCycleForm, setShowCycleForm] = useState(false)
  const [newCycle, setNewCycle] = useState({ name: '', description: '', status: 'draft', start_date: '', end_date: '' })
  const [showAgentInstr, setShowAgentInstr] = useState(false)
  const [agentInstr, setAgentInstr] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [agentInstrDirty, setAgentInstrDirty] = useState(false)

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
      setNewTask({ title: '', description: '', priority: 'medium', status: 'todo', assignee: '', start_date: '', due_date: '', selectedLabels: [] })
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

  const searchFiltered = searchQ.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(searchQ.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(searchQ.toLowerCase())
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
          onClick={() => navigate('/app')}
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
                <IssueRow
                  key={task.id}
                  task={task}
                  projectId={id}
                  projectCode={projectCode}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onCreateSubtask={handleCreateSubtask}
                  allTasks={tasks}
                />
              ))
            )}
          </div>
        )}

        {/* Board */}
        {tab === 'board' && (
          <BoardView tasks={tasks} projectCode={projectCode} onUpdate={handleUpdate} onDelete={handleDelete} onReorder={handleReorder} />
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div>
            <div className={s.timelineHint}>
              Set <strong className={s.timelineHintStrong}>start date</strong> and <strong className={s.timelineHintStrong}>due date</strong> on issues (click ✎ in Issues tab) to see them on the timeline.
            </div>
            <GanttChart tasks={tasks} />
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
