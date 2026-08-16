import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PRIORITY, STATUS_COLOR } from '../constants/theme'
import { alpha } from '../utils/color'
import { getNodeTypes } from '../api/client'

// Badge for a user-defined task-like type (ADR-0035). Built-in "task" nodes show
// nothing; a custom type renders its registry label/color (falls back to the key).
export const TypeBadge = memo(function TypeBadge({ type }) {
  const { data: nodeTypes = [] } = useQuery({
    queryKey: ['node-types'], queryFn: getNodeTypes,
    enabled: !!type && type !== 'task', staleTime: 300000,
  })
  if (!type || type === 'task') return null
  const nt = nodeTypes.find(t => t.key === type)
  const color = nt?.color || '#818cf8'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
      textTransform: 'uppercase', letterSpacing: 0.4,
      color, background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {nt?.label || type}
    </span>
  )
})

export const PriorityIcon = memo(function PriorityIcon({ priority }) {
  // The glyph lives in PRIORITY beside the colour so the shape and the hue
  // cannot drift apart; the shape is what carries the order without colour.
  const { t } = useTranslation()
  const c = PRIORITY[priority] || PRIORITY.medium
  return (
    <span
      title={t(c.labelKey)}
      style={{ color: c.color, fontSize: 9, width: 14, textAlign: 'center', flexShrink: 0 }}
    >
      {c.icon}
    </span>
  )
})

/**
 * The one priority chip. `weight` (solid / outline / ghost) plus the ▲■▼ glyph
 * carry the ordinal, so "high" reads as louder than "medium" even where the two
 * colours cannot be told apart — printed, dimmed, or by a colour-blind reader.
 * Before this the two were adjacent ambers at identical weight (ADR-0088).
 */
export const PriorityChip = memo(function PriorityChip({ priority, compact = false, className }) {
  const { t } = useTranslation()
  const p = PRIORITY[priority] || PRIORITY.medium
  const solid = p.weight === 'solid'
  const ghost = p.weight === 'ghost'
  return (
    <span className={className} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
      fontSize: compact ? 10 : 11,
      padding: compact ? '1px 5px' : '2px 7px',
      borderRadius: 4,
      color: p.color,
      background: ghost ? 'transparent' : p.bg,
      border: ghost ? '1px solid transparent' : `1px solid ${alpha(p.color, solid ? 45 : 22)}`,
      fontWeight: solid ? 700 : 500,
      letterSpacing: solid ? 0.2 : 0,
    }}>
      <span aria-hidden="true" style={{ fontSize: compact ? 7 : 8 }}>{p.icon}</span>
      {t(p.labelKey)}
    </span>
  )
})

export const StatusIcon = memo(function StatusIcon({ status }) {
  const size = 14
  if (status === 'done') return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6.5" fill={STATUS_COLOR.done} />
      {/* Knocked out of the page background, not black: in light mode the
          filled circle is a dark green and a black tick vanishes into it. */}
      <polyline points="4,7 6.5,9.5 10,5" fill="none" stroke="var(--kt-bg, #171717)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
