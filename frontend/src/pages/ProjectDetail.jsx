import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Tag, Zap, X } from 'lucide-react'
import {
  getProject, createTask, updateTask, deleteTask, updateProject,
  createLabel, deleteLabel, addLabelToTask,
  createCycle, updateCycle, deleteCycle, addTaskToCycle, removeTaskFromCycle,
} from '../api/client'
import IssueRow from '../components/IssueRow'
import GanttChart from '../components/GanttChart'
import BoardView from '../components/BoardView'
import TableView from '../components/TableView'
import TaskCreateForm from '../components/TaskCreateForm'
import CyclePanel from '../components/CyclePanel'
import { BRAND, LABEL_PALETTE } from '../constants/theme'

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
          padding: '5px 12px', borderRadius: 6, border: '1px solid #e5e7eb',
          background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151',
        }}
      >
        <Tag size={12} /> Labels ({labels.length})
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', right: 0, marginTop: 4,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 14, minWidth: 260,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Project Labels</div>
          {labels.length === 0 && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>No labels yet.</div>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>New label</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Label name"
              style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
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
              width: '100%', padding: '6px 0', border: 'none', borderRadius: 6,
              background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
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
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState('issues')
  const [filter, setFilter] = useState('all')
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

  const handleUpdate = (taskId, data) => updateMut.mutate({ taskId, data })
  const handleDelete = (taskId) => deleteMut.mutate(taskId)
  const handleCreateSubtask = (parentId, title) => createSubtaskMut.mutate({ parentId, title })

  const projectCode = project?.name?.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TSK'
  const filteredTopTasks = filter === 'all' ? topTasks : topTasks.filter(t => t.status === filter)

  const tabStyle = (t) => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 500,
    border: 'none', background: 'none', cursor: 'pointer',
    color: tab === t ? '#0f172a' : '#6b7280',
    borderBottom: tab === t ? `2px solid ${BRAND}` : '2px solid transparent',
    marginBottom: -1,
  })

  const openQuickAdd = () => {
    setShowForm(true)
    setTab('issues')
  }

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
      Loading…
    </div>
  )

  if (!project) return <div style={{ padding: 32, color: '#ef4444' }}>Project not found</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid #e5e7eb' }}>
        <button
          onClick={() => navigate('/app')}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#6b7280', fontSize: 12, padding: 0, marginBottom: 14,
          }}
        >
          <ArrowLeft size={12} /> My Issues
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: BRAND, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 15,
          }}>
            {project.name.charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{project.name}</h1>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                background: project.status === 'archived' ? '#f3f4f6' : '#f0fdf4',
                color: project.status === 'archived' ? '#6b7280' : '#16a34a',
              }}>
                {project.status === 'archived' ? 'Archived' : 'Active'}
              </span>
            </div>
            {project.description && (
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{project.description}</p>
            )}
            {labels.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {labels.map(lb => <LabelChip key={lb.id} label={lb} />)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', position: 'relative' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{project.done_tasks}/{project.total_tasks} done</div>
              <div style={{ width: 90, height: 5, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
                <div style={{ height: '100%', width: `${project.progress}%`, background: BRAND, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
            <LabelManager
              labels={labels}
              onCreateLabel={data => createLabelMut.mutate(data)}
              onDeleteLabel={labelId => deleteLabelMut.mutate(labelId)}
            />
            <button
              onClick={() => archiveMut.mutate()}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
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
                <span style={{ background: BRAND, color: '#fff', borderRadius: 10, fontSize: 9, padding: '1px 5px', fontWeight: 700 }}>
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
      />

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Issues */}
        {tab === 'issues' && (
          <div>
            <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap' }}>
              {['all', 'todo', 'in_progress', 'done', 'failed'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '3px 10px', borderRadius: 20,
                  border: filter === f ? `1px solid ${BRAND}` : '1px solid #e5e7eb',
                  background: filter === f ? '#eef0ff' : '#fff',
                  color: filter === f ? BRAND : '#6b7280',
                  fontSize: 12, cursor: 'pointer', fontWeight: filter === f ? 600 : 400,
                }}>
                  {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                  {' '}<span style={{ fontSize: 11 }}>{f === 'all' ? topTasks.length : topTasks.filter(t => t.status === f).length}</span>
                </button>
              ))}
            </div>

            {filteredTopTasks.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', padding: '0 16px', height: 28, gap: 8,
                borderBottom: '1px solid #f3f4f6', background: '#fafafa',
              }}>
                <span style={{ width: 12 }} /><span style={{ width: 22 }} /><span style={{ width: 14 }} />
                <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 64 }}>ID</span>
                <span style={{ flex: 1, fontSize: 11, color: '#9ca3af' }}>Title</span>
                <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 70 }}>Due date</span>
                <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 60 }}>Priority</span>
                <span style={{ width: 88 }} />
              </div>
            )}

            {filteredTopTasks.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
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
          <BoardView tasks={tasks} projectCode={projectCode} onUpdate={handleUpdate} onDelete={handleDelete} />
        )}

        {/* Timeline */}
        {tab === 'timeline' && (
          <div>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
              Set <strong>start date</strong> and <strong>due date</strong> on issues (click ✎ in Issues tab) to see them on the timeline.
            </div>
            <GanttChart tasks={tasks} />
          </div>
        )}

        {/* Table */}
        {tab === 'table' && (
          <TableView tasks={tasks} projectId={id} labels={labels} cycles={cycles} onUpdate={handleUpdate} />
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
          background: BRAND, color: '#fff', border: 'none', cursor: 'pointer',
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
