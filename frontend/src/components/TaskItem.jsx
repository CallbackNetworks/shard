import { useState } from 'react'
import { DARK } from '../constants/theme'

const STATUS_COLORS = {
  todo: 'rgba(255,255,255,0.08)',
  in_progress: 'rgba(83,157,245,0.15)',
  done: 'rgba(30,215,96,0.12)',
  failed: 'rgba(243,114,127,0.12)',
}
const STATUS_TEXT = {
  todo: 'rgba(255,255,255,0.5)',
  in_progress: '#539df5',
  done: '#1ed760',
  failed: '#f3727f',
}
const PRIORITY_COLORS = {
  low: 'rgba(179,179,179,0.12)',
  medium: 'rgba(255,164,43,0.12)',
  high: 'rgba(243,114,127,0.12)',
}
const PRIORITY_TEXT = {
  low: '#b3b3b3',
  medium: '#ffa42b',
  high: '#f3727f',
}

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
    <span style={{
      background: bg, color, borderRadius: 9999,
      padding: '2px 10px', fontSize: 11, fontWeight: 700,
      textTransform: 'capitalize', letterSpacing: '0.05em',
    }}>{text}</span>
  )

  return (
    <div style={{
      background: DARK.surface, borderRadius: 8, padding: '14px 16px',
      boxShadow: 'rgba(0,0,0,0.3) 0px 4px 8px',
      display: 'flex', flexDirection: 'column', gap: 10
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: DARK.text }}>{task.title}</span>
          {task.description && <p style={{ color: DARK.textMid, fontSize: 13, marginTop: 4, marginBottom: 0 }}>{task.description}</p>}
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
          style={{
            fontSize: 13, fontWeight: 600, borderRadius: 9999,
            border: '1px solid rgba(255,255,255,0.15)', padding: '4px 12px',
            cursor: 'pointer', background: DARK.elevated, color: DARK.text,
          }}
        >
          <option value="todo">todo</option>
          <option value="in_progress">in progress</option>
          <option value="done">done</option>
          <option value="failed">failed</option>
        </select>

        <button
          onClick={copyToken}
          style={{
            fontSize: 12, fontWeight: 700,
            background: DARK.elevated, border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 9999, padding: '4px 14px', cursor: 'pointer', color: DARK.text,
            textTransform: 'uppercase', letterSpacing: '1px',
          }}
        >{copied ? 'Copied!' : 'Copy Webhook'}</button>

        <button
          onClick={e => { e.stopPropagation(); onDelete(task.id) }}
          style={{
            fontSize: 12, fontWeight: 700, background: 'none',
            border: '1px solid rgba(243,114,127,0.4)', borderRadius: 9999,
            padding: '4px 14px', cursor: 'pointer', color: DARK.danger, marginLeft: 'auto',
            textTransform: 'uppercase', letterSpacing: '1px',
          }}
        >Delete</button>
      </div>

      <div style={{
        fontSize: 11, color: DARK.textMid, fontFamily: 'monospace',
        background: DARK.elevated, borderRadius: 4, padding: '6px 10px', wordBreak: 'break-all',
      }}>
        POST /webhook/callback/{task.callback_token}
      </div>
    </div>
  )
}
