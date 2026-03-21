import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Pencil, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw, FileText } from 'lucide-react'
import { regenerateToken } from '../api/client'
import { PRIORITY, STATUS_MAP } from '../constants/theme'
import MarkdownEditor from './MarkdownEditor'
import MarkdownPreview from './MarkdownPreview'

function PriorityIcon({ priority }) {
  const icons = { high: '▲', medium: '■', low: '▼' }
  const c = PRIORITY[priority] || PRIORITY.medium
  return (
    <span style={{ color: c.color, fontSize: 9, width: 14, textAlign: 'center', flexShrink: 0 }}>
      {icons[priority] || '■'}
    </span>
  )
}

function StatusIcon({ status }) {
  const size = 14
  if (status === 'done') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6.5" fill="#22c55e" />
      <polyline points="4,7 6.5,9.5 10,5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (status === 'in_progress') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
      <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
  if (status === 'failed') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#ef4444" strokeWidth="1.5" />
      <line x1="5" y1="5" x2="9" y2="9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="5" x2="5" y2="9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3.5 2" />
    </svg>
  )
}

function LabelChip({ label }) {
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 500,
      background: label.color + '22',
      color: label.color,
      border: `1px solid ${label.color}44`,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {label.name}
    </span>
  )
}

export default function IssueRow({
  task, projectId, projectCode, onUpdate, onDelete,
  showProject, projectName, onCreateSubtask,
  allTasks = [], depth = 0,
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [editData, setEditData] = useState({
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    status: task.status,
    start_date: task.start_date ? task.start_date.split('T')[0] : '',
    due_date: task.due_date ? task.due_date.split('T')[0] : '',
  })

  const qc = useQueryClient()
  const regenMut = useMutation({
    mutationFn: () => regenerateToken(projectId, task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const issueId = `${(projectCode || 'TSK')}-${task.id.slice(-4).toUpperCase()}`
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const s = STATUS_MAP[task.status] || STATUS_MAP.todo
  const labels = task.labels || []
  const subtaskCount = task.subtask_count || 0

  // Find actual subtask objects from allTasks
  const subtasks = allTasks.filter(t => t.parent_id === task.id)

  const copyWebhook = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(`${window.location.origin}/webhook/callback/${task.callback_token}`)
  }

  const saveEdit = () => {
    const data = { ...editData }
    if (!data.start_date) delete data.start_date
    else data.start_date = new Date(data.start_date).toISOString()
    if (!data.due_date) delete data.due_date
    else data.due_date = new Date(data.due_date).toISOString()
    if (!data.description) delete data.description
    onUpdate(task.id, data)
    setEditing(false)
  }

  const handleCreateSubtask = () => {
    if (!subtaskTitle.trim()) return
    onCreateSubtask && onCreateSubtask(task.id, subtaskTitle.trim())
    setSubtaskTitle('')
    setShowSubtaskForm(false)
    setExpanded(true)
  }

  if (editing) {
    return (
      <div style={{ paddingLeft: depth * 24, background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              autoFocus
              value={editData.title}
              onChange={e => setEditData(p => ({ ...p, title: e.target.value }))}
              placeholder="Issue title"
              style={{ flex: '1 1 200px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none' }}
            />
            <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
            </select>
            <select value={editData.priority} onChange={e => setEditData(p => ({ ...p, priority: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input type="date" value={editData.start_date} onChange={e => setEditData(p => ({ ...p, start_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            <span style={{ color: '#9ca3af', fontSize: 12 }}>→</span>
            <input type="date" value={editData.due_date} onChange={e => setEditData(p => ({ ...p, due_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <MarkdownEditor
              value={editData.description}
              onChange={(val) => setEditData(p => ({ ...p, description: val }))}
              placeholder="Description (optional, supports Markdown)"
              minHeight={80}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setEditing(false)} style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveEdit} style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: '#5e6ad2', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Save</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center',
          padding: `0 16px 0 ${16 + depth * 20}px`, height: 36, gap: 8,
          borderBottom: '1px solid #f3f4f6',
          background: hovered ? '#f8fafc' : '#fff',
        }}
      >
        {/* Expand/collapse for subtasks */}
        {subtaskCount > 0 || subtasks.length > 0 ? (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        <PriorityIcon priority={task.priority} />
        <StatusIcon status={task.status} />

        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', minWidth: 64, flexShrink: 0 }}>
          {issueId}
        </span>

        <span style={{
          flex: 1, fontSize: 13,
          color: task.status === 'done' ? '#9ca3af' : '#0f172a',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
          {task.description && !hovered && labels.length === 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }}
              style={{ color: '#b0b8c8', marginLeft: 6, fontSize: 11, fontWeight: 400, cursor: 'pointer' }}
            >
              {task.description.length > 60 ? task.description.slice(0, 60) + '…' : task.description}
            </span>
          )}
        </span>

        {/* Label chips */}
        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'nowrap', overflow: 'hidden', maxWidth: 160 }}>
            {labels.slice(0, 3).map(lb => <LabelChip key={lb.id} label={lb} />)}
          </div>
        )}

        {/* Subtask count badge */}
        {subtaskCount > 0 && (
          <span style={{
            fontSize: 10, color: '#6b7280', background: '#f3f4f6',
            padding: '1px 6px', borderRadius: 10, flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {subtaskCount} sub
          </span>
        )}

        {showProject && projectName && (
          <span style={{ fontSize: 11, color: '#94a3b8', background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {projectName}
          </span>
        )}

        {task.due_date && (
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </span>
        )}

        <span style={{
          fontSize: 11, color: p.color, background: p.bg,
          padding: '2px 7px', borderRadius: 4, fontWeight: 500, flexShrink: 0,
        }}>
          {p.label}
        </span>

        {hovered ? (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {task.description && (
              <button onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }} title="Toggle description" style={{ background: showDescription ? '#eef0ff' : 'none', border: 'none', cursor: 'pointer', color: showDescription ? '#5e6ad2' : '#9ca3af', padding: '2px 5px', borderRadius: 4 }}>
                <FileText size={12} />
              </button>
            )}
            <button onClick={copyWebhook} title="Copy webhook URL" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4 }}>
              <Link2 size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm('Regenerate webhook token? Old URLs will stop working.')) regenMut.mutate() }}
              title="Regenerate webhook token"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4 }}
            >
              <RefreshCw size={12} />
            </button>
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4 }}>
              <Pencil size={12} />
            </button>
            {onCreateSubtask && (
              <button
                onClick={() => { setShowSubtaskForm(v => !v); setExpanded(true) }}
                title="Add subtask"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4 }}
              >
                <Plus size={12} />
              </button>
            )}
            <button onClick={() => { if (confirm(`Delete "${task.title}"?`)) onDelete(task.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4 }}>
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <div style={{ width: onCreateSubtask ? 110 : 88, flexShrink: 0 }} />
        )}
      </div>

      {/* Expanded description preview */}
      {showDescription && task.description && (
        <div style={{
          paddingLeft: 16 + depth * 20 + 36,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 10,
          borderBottom: '1px solid #f3f4f6',
          background: '#fafbfc',
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          <MarkdownPreview content={task.description} />
        </div>
      )}

      {/* Inline subtask creation form */}
      {showSubtaskForm && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          padding: `6px 16px 6px ${16 + (depth + 1) * 20 + 12}px`,
          background: '#f8fafc', borderBottom: '1px solid #f3f4f6',
        }}>
          <input
            autoFocus
            value={subtaskTitle}
            onChange={e => setSubtaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateSubtask(); if (e.key === 'Escape') setShowSubtaskForm(false) }}
            placeholder="Subtask title…"
            style={{ flex: 1, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, outline: 'none' }}
          />
          <button onClick={handleCreateSubtask} style={{ padding: '4px 10px', border: 'none', borderRadius: 5, background: '#5e6ad2', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Add</button>
          <button onClick={() => setShowSubtaskForm(false)} style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 5, background: '#fff', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      {/* Subtasks (expanded) */}
      {expanded && subtasks.map(sub => (
        <IssueRow
          key={sub.id}
          task={sub}
          projectId={projectId}
          projectCode={projectCode}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCreateSubtask={onCreateSubtask}
          allTasks={allTasks}
          depth={depth + 1}
        />
      ))}
    </>
  )
}
