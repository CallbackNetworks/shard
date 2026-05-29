import { PRIORITY } from '../constants/theme'

export function PriorityIcon({ priority }) {
  const icons = { high: '\u25B2', medium: '\u25A0', low: '\u25BC' }
  const c = PRIORITY[priority] || PRIORITY.medium
  return (
    <span style={{ color: c.color, fontSize: 9, width: 14, textAlign: 'center', flexShrink: 0 }}>
      {icons[priority] || '\u25A0'}
    </span>
  )
}

export function StatusIcon({ status }) {
  const size = 14
  if (status === 'done') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6.5" fill="#1ed760" />
      <polyline points="4,7 6.5,9.5 10,5" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (status === 'in_progress') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#539df5" strokeWidth="1.5" />
      <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="#539df5" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
  if (status === 'failed') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#f3727f" strokeWidth="1.5" />
      <line x1="5" y1="5" x2="9" y2="9" stroke="#f3727f" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="5" x2="5" y2="9" stroke="#f3727f" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3.5 2" />
    </svg>
  )
}

export function LabelChip({ label }) {
  const isDecision = label.type === 'decision'
  const isDashed = isDecision && label.decision_status === 'proposed'
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 500,
      background: label.color + '22',
      color: label.color,
      border: isDashed ? `1px dashed ${label.color}88` : `1px solid ${label.color}44`,
      whiteSpace: 'nowrap', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      {isDecision && (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      )}
      {label.name}
    </span>
  )
}
