import { useState } from 'react'

const STATUS_COLORS = { todo: '#e5e7eb', in_progress: '#fef3c7', done: '#d1fae5', failed: '#fee2e2' }
const STATUS_TEXT = { todo: '#6b7280', in_progress: '#92400e', done: '#065f46', failed: '#991b1b' }
const PRIORITY_COLORS = { low: '#dbeafe', medium: '#fef9c3', high: '#fee2e2' }
const PRIORITY_TEXT = { low: '#1d4ed8', medium: '#854d0e', high: '#991b1b' }

export default function TaskItem({ task, projectId, onUpdate, onDelete }) {
  const [copied, setCopied] = useState(false)

  const copyToken = (e) => {
    e.stopPropagation()
    const url = `${window.location.origin}/webhook/callback/${task.callback_token}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const badge = (text, bg, color) => (
    <span style={{ background: bg, color, borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{text}</span>
  )

  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', gap: 8
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{task.title}</span>
          {task.description && <p style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>{task.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {badge(task.priority, PRIORITY_COLORS[task.priority], PRIORITY_TEXT[task.priority])}
          {badge(task.status.replace('_', ' '), STATUS_COLORS[task.status], STATUS_TEXT[task.status])}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={task.status}
          onChange={e => onUpdate(task.id, { status: e.target.value })}
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db', padding: '3px 8px', cursor: 'pointer' }}
        >
          <option value="todo">todo</option>
          <option value="in_progress">in progress</option>
          <option value="done">done</option>
          <option value="failed">failed</option>
        </select>

        <button
          onClick={copyToken}
          style={{ fontSize: 12, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: '#374151' }}
        >{copied ? 'Copied!' : 'Copy webhook URL'}</button>

        <button
          onClick={e => { e.stopPropagation(); onDelete(task.id) }}
          style={{ fontSize: 12, background: 'none', border: '1px solid #fca5a5', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: '#ef4444', marginLeft: 'auto' }}
        >Delete</button>
      </div>

      <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', background: '#f9fafb', borderRadius: 6, padding: '4px 8px', wordBreak: 'break-all' }}>
        POST /webhook/callback/{task.callback_token}
      </div>
    </div>
  )
}
