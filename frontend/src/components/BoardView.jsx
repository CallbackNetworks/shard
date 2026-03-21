import { useState } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import { STATUS_COLS, PRIORITY } from '../constants/theme'

function BoardCard({ task, projectCode, onUpdate, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const issueId = `${projectCode}-${task.id.slice(-4).toUpperCase()}`
  const labels = task.labels || []

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
        padding: '10px 12px', cursor: 'default',
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4, fontFamily: 'monospace' }}>{issueId}</div>
      <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.4, marginBottom: 6 }}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4, marginBottom: 6 }}>
          {task.description.length > 80 ? task.description.slice(0, 80) + '…' : task.description}
        </div>
      )}
      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
          {labels.map(lb => (
            <span key={lb.id} style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 500,
              background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
            }}>{lb.name}</span>
          ))}
        </div>
      )}
      {task.assignee && (
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#e5e7eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#6b7280' }}>
            {task.assignee.charAt(0).toUpperCase()}
          </span>
          {task.assignee}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, color: p.color, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 8 }}>{p.icon}</span> {p.label}
        </span>
        {hovered ? (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/webhook/callback/${task.callback_token}`)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 4px' }}
            >
              <Link2 size={11} />
            </button>
            <select
              value={task.status}
              onChange={e => onUpdate(task.id, { status: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 4px', background: '#fff' }}
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
            </select>
            <button
              onClick={() => { if (confirm(`Delete "${task.title}"?`)) onDelete(task.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 4px' }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ) : (
          task.due_date && (
            <span style={{ fontSize: 10, color: '#9ca3af' }}>
              {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          )
        )}
      </div>
    </div>
  )
}

export default function BoardView({ tasks, projectCode, onUpdate, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: 16, overflowX: 'auto', alignItems: 'flex-start', minHeight: '100%' }}>
      {STATUS_COLS.map(col => {
        const colTasks = tasks.filter(t => t.status === col.key && t.parent_id == null)
        return (
          <div key={col.key} style={{ width: 258, minWidth: 258, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 2 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{col.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, background: '#f3f4f6', color: '#6b7280', padding: '1px 6px', borderRadius: 10 }}>
                {colTasks.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {colTasks.map(task => (
                <BoardCard
                  key={task.id}
                  task={task}
                  projectCode={projectCode}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                />
              ))}
            </div>
            {colTasks.length === 0 && (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                border: '1px dashed #e5e7eb', color: '#d1d5db', fontSize: 12, textAlign: 'center',
              }}>
                No issues
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
