import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Tag, Zap, X, SlidersHorizontal } from 'lucide-react'
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
import { BRAND, LABEL_PALETTE, SHADOW_LG, INSET_SHADOW } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

function LabelChip({ label, onRemove }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500,
      background: label.color + '22', color: label.color,
      border: `1px solid ${label.color}44`,
    }}>
      {label.name}
      {onRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: label.color, padding: 0, lineHeight: 1, display: 'flex' }}>
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
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 14px', borderRadius: 9999, border: '1px solid rgba(255,255,255,0.15)',
          background: 'transparent', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#ffffff',
          textTransform: 'uppercase', letterSpacing: '1px',
        }}
      >
        <Tag size={12} /> Labels ({labels.length})
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', right: 0, marginTop: 4,
          background: '#181818', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          boxShadow: SHADOW_LG, padding: 14, minWidth: 260,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>Project Labels</div>
          {labels.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>No labels yet.</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
            {labels.map(lb => (
              <span key={lb.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500,
                background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
              }}>
                {lb.name}
                <button onClick={() => onDeleteLabel(lb.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: lb.color, padding: 0, lineHeight: 1, display: 'flex' }}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>New label</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Label name"
              style={{ flex: 1, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {LABEL_PALETTE.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                style={{
                  width: 20, height: 20, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                  outline: newColor === c ? `2px solid ${c}` : '2px solid transparent',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
          <button
            disabled={!newName.trim()}
            onClick={() => { if (newName.trim()) { onCreateLabel({ name: newName.trim(), color: newColor }); setNewName('') } }}
            style={{
              width: '100%', padding: '8px 0', border: 'none', borderRadius: 9999,
              background: BRAND, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '1.4px',
              opacity: newName.trim() ? 1 : 0.5,
            }}
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
  const [showFilters, setShowFilters] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newTask, setNewTask] = useState({
    title: '', description: '', priority: 'medium', status: 'todo', assignee: '', start_date: '', due_date: '',
    selectedLabels: [],
  })
  const [showCycleForm, setShowCycleForm] = useState(false)
  const [newCycle, setNewCycle] = useState({ name: '', description: '', status: 'draft', start_date: '', end_date: '' })

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

  const applyFilters = (list) => {
    let result = list
    if (filter !== 'all') result = result.filter(t => t.status === filter)
    if (filterPriority !== 'all') result = result.filter(t => t.priority === filterPriority)
    if (filterLabel !== 'all') result = result.filter(t => (t.labels || []).some(l => l.id === filterLabel))
    if (filterAssignee !== 'all') result = result.filter(t => t.assignee === filterAssignee)
    if (filterDue === 'overdue') result = result.filter(t => t.due_date && new Date(t.due_date) < new Date())
    else if (filterDue === 'this_week') {
      const now = new Date(); const end = new Date(); end.setDate(now.getDate() + 7)
      result = result.filter(t => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= end)
    } else if (filterDue === 'no_date') result = result.filter(t => !t.due_date)
    return result
  }

  const activeFilterCount = [filterPriority, filterLabel, filterAssignee, filterDue].filter(f => f !== 'all').length

  const searchFiltered = searchQ.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(searchQ.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(searchQ.toLowerCase())
      )
    : null
  const filteredTopTasks = searchFiltered
    ? applyFilters(searchFiltered)
    : applyFilters(topTasks)

  const tabStyle = (t) => ({
    padding: '10px 16px', fontSize: 14, fontWeight: tab === t ? 700 : 400,
    border: 'none', background: 'none', cursor: 'pointer',
    color: tab === t ? '#ffffff' : '#b3b3b3',
    borderBottom: tab === t ? `2px solid ${BRAND}` : '2px solid transparent',
    marginBottom: -1, transition: 'color 0.15s',
  })

  const openQuickAdd = () => {
    setShowForm(true)
    setTab('issues')
  }

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#b3b3b3', background: '#121212' }}>
      <div style={{ width: 18, height: 18, border: `2px solid #1ed760`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 10 }} />
      Loading…
    </div>
  )

  if (!project) return <div style={{ padding: 32, color: '#f3727f', background: '#121212' }}>Project not found</div>

  const identColor = project.identities?.[0]?.color || BRAND

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#121212', color: '#ffffff' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 12px 0' : '16px 24px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.015)' }}>
        <button
          onClick={() => navigate('/app')}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: 0, marginBottom: 14,
            transition: 'color 0.15s',
          }}
        >
          <ArrowLeft size={12} /> My Issues
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: `linear-gradient(135deg, ${identColor}cc, ${identColor}66)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 15,
            boxShadow: `0 0 14px ${identColor}44`,
          }}>
            {project.name.charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#ffffff' }}>{project.name}</h1>
              <span style={{
                fontSize: 10, padding: '2px 9px', borderRadius: 9999, fontWeight: 600,
                background: project.status === 'archived' ? 'rgba(255,255,255,0.06)' : 'rgba(30,215,96,0.1)',
                color: project.status === 'archived' ? '#b3b3b3' : '#1ed760',
                border: `1px solid ${project.status === 'archived' ? 'rgba(255,255,255,0.08)' : 'rgba(30,215,96,0.3)'}`,
                textTransform: 'capitalize', letterSpacing: '0.05em',
              }}>
                {project.status === 'archived' ? 'Archived' : 'Active'}
              </span>
            </div>
            {project.description && (
              <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>{project.description}</p>
            )}
            {labels.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {labels.map(lb => <LabelChip key={lb.id} label={lb} />)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', position: 'relative' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{project.done_tasks}/{project.total_tasks} done</div>
              <div style={{ width: 90, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ height: '100%', width: `${project.progress}%`, background: '#1ed760', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>
            <LabelManager
              labels={labels}
              onCreateLabel={data => createLabelMut.mutate(data)}
              onDeleteLabel={labelId => deleteLabelMut.mutate(labelId)}
            />
            <button
              onClick={() => archiveMut.mutate()}
              style={{ padding: '7px 16px', borderRadius: 9999, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px' }}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 18px', borderRadius: 9999, border: 'none',
                background: '#1ed760',
                color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '1.4px',
                boxShadow: 'rgba(0,0,0,0.3) 0px 4px 8px',
              }}
            >
              <Plus size={13} /> New Issue
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex' }}>
          <button style={tabStyle('issues')} onClick={() => setTab('issues')}>Issues</button>
          <button style={tabStyle('board')} onClick={() => setTab('board')}>Board</button>
          <button style={tabStyle('timeline')} onClick={() => setTab('timeline')}>Timeline</button>
          <button style={tabStyle('table')} onClick={() => setTab('table')}>Table</button>
          <button style={tabStyle('cycles')} onClick={() => setTab('cycles')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap size={12} /> Cycles
              {cycles.filter(c => c.status === 'active').length > 0 && (
                <span style={{ background: BRAND, color: '#000', borderRadius: 9999, fontSize: 9, padding: '1px 6px', fontWeight: 700 }}>
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
      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Issues */}
        {tab === 'issues' && (
          <div>
            <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
              {!searchQ && ['all', 'todo', 'in_progress', 'done', 'failed'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '4px 14px', borderRadius: 9999, fontSize: 13, cursor: 'pointer', fontWeight: filter === f ? 700 : 400,
                  border: filter === f ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  background: filter === f ? '#1f1f1f' : 'transparent',
                  color: filter === f ? '#ffffff' : '#b3b3b3',
                  transition: 'all 0.15s',
                }}>
                  {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                  {' '}<span style={{ fontSize: 11, opacity: 0.7 }}>{f === 'all' ? topTasks.length : topTasks.filter(t => t.status === f).length}</span>
                </button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setShowFilters(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 12px', borderRadius: 9999, fontSize: 12, cursor: 'pointer',
                    border: activeFilterCount > 0 ? '1px solid rgba(30,215,96,0.4)' : '1px solid rgba(255,255,255,0.15)',
                    background: activeFilterCount > 0 ? 'rgba(30,215,96,0.08)' : 'transparent',
                    color: activeFilterCount > 0 ? '#1ed760' : '#b3b3b3',
                    fontWeight: 600,
                  }}
                >
                  <SlidersHorizontal size={12} />
                  Filter
                  {activeFilterCount > 0 && (
                    <span style={{ background: '#1ed760', color: '#000', borderRadius: 9999, fontSize: 9, padding: '1px 5px', fontWeight: 700 }}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search issues\u2026"
                  style={{
                    padding: '6px 14px', borderRadius: 9999, fontSize: 13,
                    border: 'none', outline: 'none',
                    background: '#1f1f1f',
                    color: '#ffffff', width: 160,
                    boxShadow: INSET_SHADOW,
                  }}
                />
                {searchQ && (
                  <button onClick={() => setSearchQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 0, display: 'flex' }}>
                    {'\u2715'}
                  </button>
                )}
              </div>
            </div>

            {/* Advanced filter bar */}
            {showFilters && (
              <div style={{
                display: 'flex', gap: 8, padding: '8px 16px', flexWrap: 'wrap', alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)',
              }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filters:</span>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, border: '1px solid rgba(255,255,255,0.12)', background: filterPriority !== 'all' ? 'rgba(30,215,96,0.08)' : 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }}>
                  <option value="all">Priority: All</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, border: '1px solid rgba(255,255,255,0.12)', background: filterLabel !== 'all' ? 'rgba(30,215,96,0.08)' : 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }}>
                  <option value="all">Label: All</option>
                  {labels.map(lb => <option key={lb.id} value={lb.id}>{lb.name}</option>)}
                </select>
                <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, border: '1px solid rgba(255,255,255,0.12)', background: filterAssignee !== 'all' ? 'rgba(30,215,96,0.08)' : 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }}>
                  <option value="all">Assignee: All</option>
                  {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <select value={filterDue} onChange={e => setFilterDue(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, border: '1px solid rgba(255,255,255,0.12)', background: filterDue !== 'all' ? 'rgba(30,215,96,0.08)' : 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }}>
                  <option value="all">Due: All</option>
                  <option value="overdue">Overdue</option>
                  <option value="this_week">This week</option>
                  <option value="no_date">No date</option>
                </select>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setFilterPriority('all'); setFilterLabel('all'); setFilterAssignee('all'); setFilterDue('all') }}
                    style={{ padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(243,114,127,0.3)', background: 'transparent', fontSize: 11, cursor: 'pointer', color: '#f3727f', fontWeight: 600 }}
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            {filteredTopTasks.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', padding: '0 16px', height: 28, gap: 8,
                borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)',
              }}>
                <span style={{ width: 12 }} /><span style={{ width: 22 }} /><span style={{ width: 14 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', minWidth: 64 }}>ID</span>
                <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Title</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', minWidth: 70 }}>Due date</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', minWidth: 60 }}>Priority</span>
                <span style={{ width: 88 }} />
              </div>
            )}

            {filteredTopTasks.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
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
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.01)' }}>
              Set <strong style={{ color: 'rgba(255,255,255,0.5)' }}>start date</strong> and <strong style={{ color: 'rgba(255,255,255,0.5)' }}>due date</strong> on issues (click ✎ in Issues tab) to see them on the timeline.
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
        style={{
          position: 'fixed', bottom: 28, right: 28,
          width: 48, height: 48, borderRadius: '50%',
          background: BRAND, color: '#000', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(94,106,210,0.45)',
          zIndex: 100,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(94,106,210,0.55)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(94,106,210,0.45)' }}
      >
        <Plus size={22} />
      </button>
    </div>
  )
}
