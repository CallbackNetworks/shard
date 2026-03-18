import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProject, getTasks, createTask, updateTask, deleteTask, updateProject } from '../api/client'
import ProgressBar from '../components/ProgressBar'
import TaskItem from '../components/TaskItem'

const GROUP_ORDER = ['in_progress', 'todo', 'done', 'failed']
const GROUP_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', failed: 'Failed' }

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: project, isLoading: loadingProject } = useQuery({ queryKey: ['project', id], queryFn: () => getProject(id) })
  const { data: tasks = [], isLoading: loadingTasks } = useQuery({ queryKey: ['tasks', id], queryFn: () => getTasks(id) })

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState('medium')
  const [showForm, setShowForm] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks', id] })
    qc.invalidateQueries({ queryKey: ['project', id] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const createMut = useMutation({
    mutationFn: () => createTask(id, { title, description: desc || undefined, priority }),
    onSuccess: () => { invalidate(); setTitle(''); setDesc(''); setPriority('medium'); setShowForm(false) }
  })

  const updateMut = useMutation({
    mutationFn: ({ taskId, data }) => updateTask(id, taskId, data),
    onSuccess: invalidate
  })

  const deleteMut = useMutation({
    mutationFn: (taskId) => deleteTask(id, taskId),
    onSuccess: invalidate
  })

  const archiveMut = useMutation({
    mutationFn: () => updateProject(id, { status: project.status === 'active' ? 'archived' : 'active' }),
    onSuccess: invalidate
  })

  if (loadingProject || loadingTasks) return <p style={{ color: '#6b7280' }}>Loading...</p>
  if (!project) return <p>Project not found</p>

  const grouped = GROUP_ORDER.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s)
    return acc
  }, {})

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}>← Back</button>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{project.name}</h1>
            {project.description && <p style={{ color: '#6b7280', marginTop: 4 }}>{project.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => archiveMut.mutate()}
              style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
            >{project.status === 'active' ? 'Archive' : 'Unarchive'}</button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <ProgressBar value={project.progress} height={10} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13, color: '#6b7280' }}>
            <span>{project.done_tasks}/{project.total_tasks} tasks done</span>
            <span style={{ fontWeight: 700, color: project.progress === 100 ? '#10b981' : '#4f46e5' }}>{project.progress}%</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 18 }}>Tasks</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
        >+ Add Task</button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12, fontWeight: 600 }}>New Task</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              placeholder="Task title *"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
            />
            <textarea
              placeholder="Description (optional)"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14, resize: 'vertical' }}
            />
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
            >
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => createMut.mutate()}
                disabled={!title.trim() || createMut.isPending}
                style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}
              >{createMut.isPending ? 'Adding...' : 'Add Task'}</button>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No tasks yet. Add one above.</div>
      ) : (
        GROUP_ORDER.map(status => {
          const group = grouped[status]
          if (!group.length) return null
          return (
            <div key={status} style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                {GROUP_LABELS[status]} ({group.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {group.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    projectId={id}
                    onUpdate={(taskId, data) => updateMut.mutate({ taskId, data })}
                    onDelete={(taskId) => deleteMut.mutate(taskId)}
                  />
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
