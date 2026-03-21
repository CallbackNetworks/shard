import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderOpen, Archive, CheckCircle, Circle, Loader, XCircle, Clock, User, Activity } from 'lucide-react'
import { getProjects, createProject, deleteProject, getActivity } from '../api/client'
import { BRAND, STATUS_MAP, PRIORITY } from '../constants/theme'

function StatusBar({ done, inProgress, total, failed }) {
  const todo = total - done - inProgress - failed
  if (total === 0) return <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2 }} />
  return (
    <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', gap: 1 }}>
      {done > 0 && <div style={{ flex: done, background: '#22c55e' }} />}
      {inProgress > 0 && <div style={{ flex: inProgress, background: '#3b82f6' }} />}
      {failed > 0 && <div style={{ flex: failed, background: '#ef4444' }} />}
      {todo > 0 && <div style={{ flex: todo, background: '#e5e7eb' }} />}
    </div>
  )
}

function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const inProgress = Math.round((project.total_tasks - project.done_tasks) * (project.progress / 100))

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => navigate(`/app/projects/${project.id}`)}
      style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '16px 18px', cursor: 'pointer',
        boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        borderColor: hovered ? '#d1d5db' : '#e5e7eb',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: BRAND, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 14,
        }}>
          {project.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          {project.description && (
            <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.description}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
          background: project.status === 'archived' ? '#f3f4f6' : '#f0fdf4',
          color: project.status === 'archived' ? '#6b7280' : '#16a34a',
        }}>
          {project.status === 'archived' ? 'Archived' : 'Active'}
        </span>
      </div>

      <StatusBar
        total={project.total_tasks}
        done={project.done_tasks}
        inProgress={inProgress}
        failed={0}
      />

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
            <CheckCircle size={11} color="#22c55e" />
            {project.done_tasks}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
            <Circle size={11} color="#94a3b8" />
            {project.total_tasks - project.done_tasks}
          </span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: Math.round(project.progress) === 100 ? '#22c55e' : '#6b7280' }}>
          {Math.round(project.progress)}%
        </span>
        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${project.name}"?`)) onDelete(project.id) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 11, padding: '2px 4px' }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

const ACTION_ICONS = {
  'task.created': { color: '#3b82f6', label: 'Created' },
  'task.status_changed': { color: '#f59e0b', label: 'Updated' },
  'task.assigned': { color: '#8b5cf6', label: 'Assigned' },
  'task.deleted': { color: '#ef4444', label: 'Deleted' },
  'project.created': { color: '#22c55e', label: 'New Project' },
  'project.archived': { color: '#6b7280', label: 'Archived' },
  'project.deleted': { color: '#ef4444', label: 'Deleted' },
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function ActivityFeed({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>
        No activity yet
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {activities.map((a, i) => {
        const info = ACTION_ICONS[a.action] || { color: '#6b7280', label: a.action }
        return (
          <div key={a.id || i} style={{
            display: 'flex', gap: 10, padding: '8px 0',
            borderBottom: i < activities.length - 1 ? '1px solid #f3f4f6' : 'none',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: info.color,
              marginTop: 6, flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>
                {a.detail}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, display: 'flex', gap: 8 }}>
                {a.actor && <span>{a.actor}</span>}
                <span>{timeAgo(a.created_at)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskRow({ t, i, total, onClick, statusColors, priorityColors, priorityIcons }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
        borderBottom: i < total - 1 ? '1px solid #f3f4f6' : 'none',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: statusColors[t.status] || '#9ca3af', flexShrink: 0,
      }} />
      <span style={{ fontSize: 12, color: priorityColors[t.priority], flexShrink: 0 }}>
        {priorityIcons[t.priority]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.title}
        </div>
      </div>
      <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>
        {t.projectName}
      </span>
      {t.due_date && (
        <span style={{
          fontSize: 11, color: new Date(t.due_date) < new Date() && t.status !== 'done' ? '#ef4444' : '#6b7280',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <Clock size={10} />
          {new Date(t.due_date).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}

function MyWorkSection({ projects }) {
  const navigate = useNavigate()

  const statusColors = Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, v.color]))
  const priorityIcons = Object.fromEntries(Object.entries(PRIORITY).map(([k, v]) => [k, v.icon]))
  const priorityColors = Object.fromEntries(Object.entries(PRIORITY).map(([k, v]) => [k, v.color]))
  const priorityOrder = { high: 0, medium: 1, low: 2 }

  // Group tasks by identity
  const groups = {} // identityId -> { identity, tasks }
  const ungroupedTasks = []

  for (const p of projects) {
    if (!p.tasks) continue
    const pIdentities = p.identities || []

    for (const t of p.tasks) {
      if (t.status === 'done') continue  // skip completed
      const taskData = { ...t, projectName: p.name, projectId: p.id }

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

  // Sort tasks within each group
  const sortTasks = (tasks) => {
    tasks.sort((a, b) => {
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
      return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
    })
    return tasks
  }

  const identityGroups = Object.values(groups).map(g => ({ ...g, tasks: sortTasks(g.tasks) }))
  sortTasks(ungroupedTasks)

  if (identityGroups.length === 0 && ungroupedTasks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 13 }}>
        No active tasks. Create tasks and assign them to start tracking work.
      </div>
    )
  }

  // If no identities defined at all, show flat list
  const hasIdentities = identityGroups.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {identityGroups.map(({ identity: ident, tasks }) => (
        <div key={ident.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 5, background: ident.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: '#fff', fontWeight: 700,
            }}>
              {ident.avatar || ident.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{ident.name}</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {tasks.filter(t => t.status !== 'done').length} open
            </span>
          </div>
          {tasks.slice(0, 8).map((t, i) => (
            <TaskRow key={t.id + ident.id} t={t} i={i} total={Math.min(tasks.length, 8)}
              onClick={() => navigate(`/app/projects/${t.projectId}`)}
              statusColors={statusColors} priorityColors={priorityColors} priorityIcons={priorityIcons} />
          ))}
        </div>
      ))}
      {ungroupedTasks.length > 0 && (
        <div>
          {hasIdentities && (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>
              Other
            </div>
          )}
          {ungroupedTasks.slice(0, 8).map((t, i) => (
            <TaskRow key={t.id} t={t} i={i} total={Math.min(ungroupedTasks.length, 8)}
              onClick={() => navigate(`/app/projects/${t.projectId}`)}
              statusColors={statusColors} priorityColors={priorityColors} priorityIcons={priorityIcons} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const { data: activities = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => getActivity({ limit: 15 }),
    staleTime: 10000,
  })
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('active')
  const [tab, setTab] = useState('projects') // 'projects' | 'mywork'

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>My Issues</h1>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {active.length} active · {archived.length} archived
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 6, border: 'none',
            background: BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> New Project
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{ padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              autoFocus
              placeholder="Project name *"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && createMut.mutate()}
              style={{ flex: '1 1 200px', padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none' }}
            />
            <input
              placeholder="Description (optional)"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              style={{ flex: '2 1 280px', padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none' }}
            />
            <button
              onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer' }}
            >Cancel</button>
            <button
              disabled={!name.trim() || createMut.isPending}
              onClick={() => createMut.mutate()}
              style={{
                padding: '7px 16px', border: 'none', borderRadius: 6,
                background: BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: !name.trim() ? 0.5 : 1,
              }}
            >
              {createMut.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, padding: '0 24px', borderBottom: '1px solid #e5e7eb' }}>
        {[
          { key: 'projects', label: 'Projects', icon: <FolderOpen size={13} /> },
          { key: 'mywork', label: 'My Work', icon: <User size={13} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? BRAND : '#6b7280',
            borderBottom: tab === t.key ? `2px solid ${BRAND}` : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#9ca3af' }}>
            <Loader size={18} style={{ marginRight: 8 }} /> Loading...
          </div>
        ) : tab === 'mywork' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <User size={15} color={BRAND} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Active Work</h2>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px' }}>
                <MyWorkSection projects={projects} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Activity size={15} color={BRAND} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recent Activity</h2>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px' }}>
                <ActivityFeed activities={activities} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              {[
                { key: 'active', label: 'Active', icon: <FolderOpen size={12} />, count: active.length },
                { key: 'archived', label: 'Archived', icon: <Archive size={12} />, count: archived.length },
                { key: 'all', label: 'All', count: projects.length },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 20,
                  border: filter === f.key ? `1px solid ${BRAND}` : '1px solid #e5e7eb',
                  background: filter === f.key ? '#eef0ff' : '#fff',
                  color: filter === f.key ? BRAND : '#6b7280',
                  fontSize: 12, cursor: 'pointer', fontWeight: filter === f.key ? 600 : 400,
                }}>
                  {f.icon}
                  {f.label}
                  <span style={{ fontSize: 11 }}>{f.count}</span>
                </button>
              ))}
            </div>

            {displayed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
                <FolderOpen size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <p style={{ fontSize: 15, fontWeight: 500 }}>No projects yet</p>
                <p style={{ marginTop: 6, fontSize: 13 }}>Create your first project to get started</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {displayed.map(p => (
                  <ProjectCard key={p.id} project={p} onDelete={id => deleteMut.mutate(id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
