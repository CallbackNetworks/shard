import { memo } from 'react'
import { PRIORITY, STATUS_COLOR } from '../constants/theme'

export const PriorityIcon = memo(function PriorityIcon({ priority }) {
  const icons = { high: '\u25B2', medium: '\u25A0', low: '\u25BC' }
  const c = PRIORITY[priority] || PRIORITY.medium
  return (
    <span style={{ color: c.color, fontSize: 9, width: 14, textAlign: 'center', flexShrink: 0 }}>
      {icons[priority] || '\u25A0'}
    </span>
  )
})

export const StatusIcon = memo(function StatusIcon({ status }) {
  const size = 14
  if (status === 'done') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6.5" fill={STATUS_COLOR.done} />
      <polyline points="4,7 6.5,9.5 10,5" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (status === 'in_progress') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={STATUS_COLOR.in_progress} strokeWidth="1.5" />
      <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke={STATUS_COLOR.in_progress} strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
  if (status === 'failed') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={STATUS_COLOR.failed} strokeWidth="1.5" />
      <line x1="5" y1="5" x2="9" y2="9" stroke={STATUS_COLOR.failed} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="5" x2="5" y2="9" stroke={STATUS_COLOR.failed} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={STATUS_COLOR.todo} strokeWidth="1.5" strokeDasharray="3.5 2" />
    </svg>
  )
})

const PR_STATE_COLORS = {
  open: '#3fb950',
  merged: '#a371f7',
  closed: '#f85149',
}

const PR_REVIEW_LABELS = {
  review_requested: 'review?',
  approved: '✓',
  changes_requested: '±',
  commented: '💬',
}

export const PrBadge = memo(function PrBadge({ pr }) {
  const color = PR_STATE_COLORS[pr.state] || PR_STATE_COLORS.open
  const review = pr.state === 'open' ? PR_REVIEW_LABELS[pr.review_state] : null
  return (
    <a
      href={pr.pr_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${pr.pr_title || `PR #${pr.pr_number}`} (${pr.state}${pr.review_state ? ', ' + pr.review_state : ''})`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 10, fontWeight: 600, textDecoration: 'none',
        color, background: color + '18', border: `1px solid ${color}44`,
        padding: '1px 6px', borderRadius: 9999, flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      #{pr.pr_number}
      {review && <span style={{ fontWeight: 500 }}>{review}</span>}
    </a>
  )
})

export const LabelChip = memo(function LabelChip({ label }) {
  const isDecision = label.type === 'decision'
  const isDashed = isDecision && label.decision_status === 'proposed'
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 0, fontWeight: 500,
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
})
