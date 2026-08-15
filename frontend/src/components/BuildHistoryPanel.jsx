import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ExternalLink, GitCommit, GitBranch, Clock, User } from 'lucide-react'
import { getWebhookEvents } from '../api/client'
import { DARK, STATUS_COLOR } from '../constants/theme'

const STATUS_COLORS = {
  done: STATUS_COLOR.done,
  failed: STATUS_COLOR.failed,
  in_progress: STATUS_COLOR.in_progress,
  todo: STATUS_COLOR.todo,
  // Not an outcome: the callback carried a status this system could not map, so the task
  // was left alone (ADR-0051). Amber rather than grey — it wants looking at.
  unmapped: DARK.warning,
}

const statusColor = (status) => STATUS_COLORS[status] || DARK.textDim

const PROVIDER_ICONS = {
  github: '',
  gitlab: '🦊',
  jenkins: '⚙️',
  drone: '🚁',
  bitbucket: '🪣',
  gitea: '🍵',
  generic: '🔗',
}

function formatDuration(ms) {
  if (!ms) return null
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSec}s`
  const hours = Math.floor(minutes / 60)
  const remainingMin = minutes % 60
  return `${hours}h ${remainingMin}m`
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function BuildHistoryPanel({ taskId }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)

  const { data: events = [] } = useQuery({
    queryKey: ['webhook-events', taskId],
    queryFn: () => getWebhookEvents(taskId),
    enabled: expanded,
    staleTime: 15000,
  })

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.35)', fontSize: 12, padding: '4px 0' }}>
        <ChevronRight size={12} />
        {t('integrations.buildHistory')}
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setExpanded(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.5)', fontSize: 12, padding: '4px 0', fontWeight: 600 }}>
        <ChevronDown size={12} />
        {t('integrations.buildHistory')} ({events.length})
      </button>

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.2)', padding: '8px 0' }}>
          {t('integrations.noBuildHistory')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {events.map(ev => (
            <div key={ev.id} onClick={() => setSelectedEvent(selectedEvent?.id === ev.id ? null : ev)}
              style={{
                background: 'rgba(var(--kt-ink-rgb), 0.03)', border: '1px solid rgba(var(--kt-ink-rgb), 0.06)',
                borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                borderLeft: `3px solid ${statusColor(ev.status)}`,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{PROVIDER_ICONS[ev.provider] || '🔗'}</span>
                <span style={{ fontSize: 12, color: DARK.text, fontWeight: 600, flex: 1 }}>
                  {ev.message || `${ev.provider} ${ev.status}`}
                </span>
                <span style={{ fontSize: 10, color: statusColor(ev.status), fontWeight: 600, textTransform: 'uppercase' }}>
                  {ev.status}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.25)' }}>
                  {timeAgo(ev.created_at)}
                </span>
              </div>

              {/* Compact meta row */}
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                {ev.branch && (
                  <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <GitBranch size={10} /> {ev.branch}
                  </span>
                )}
                {ev.commit_sha && (
                  <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.3)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <GitCommit size={10} /> {ev.commit_sha.substring(0, 7)}
                  </span>
                )}
                {ev.build_duration_ms && (
                  <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Clock size={10} /> {formatDuration(ev.build_duration_ms)}
                  </span>
                )}
                {ev.triggered_by && (
                  <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <User size={10} /> {ev.triggered_by}
                  </span>
                )}
                {ev.build_url && (
                  <a href={ev.build_url} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 10, color: DARK.info, display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                    <ExternalLink size={10} /> View Build
                  </a>
                )}
              </div>

              {/* Expanded detail */}
              {selectedEvent?.id === ev.id && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(var(--kt-ink-rgb), 0.06)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Provider</span>
                      <span style={{ color: DARK.textMid }}>{ev.provider}</span>
                    </div>
                    {ev.event_type && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Event Type</span>
                        <span style={{ color: DARK.textMid }}>{ev.event_type}</span>
                      </div>
                    )}
                    {ev.build_number && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Build #</span>
                        <span style={{ color: DARK.textMid }}>{ev.build_number}</span>
                      </div>
                    )}
                    {ev.commit_sha && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Commit</span>
                        <span style={{ color: DARK.textMid, fontFamily: 'monospace' }}>{ev.commit_sha}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Time</span>
                      <span style={{ color: DARK.textMid }}>{new Date(ev.created_at).toLocaleString()}</span>
                    </div>
                    {ev.status === 'unmapped' && (
                      <div style={{ color: DARK.warning, lineHeight: 1.5 }}>
                        {t('integrations.unmappedExplain')}
                      </div>
                    )}
                    {ev.raw_payload && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Payload</span>
                        <pre style={{
                          margin: 0, flex: 1, maxHeight: 200, overflow: 'auto', fontSize: 10,
                          color: DARK.textMid, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}>
                          {JSON.stringify(ev.raw_payload, null, 2)}
                        </pre>
                      </div>
                    )}
                    {ev.test_summary && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', minWidth: 80 }}>Tests</span>
                        <span style={{ color: DARK.textMid }}>
                          {ev.test_summary.passed && <span style={{ color: STATUS_COLOR.done }}>{ev.test_summary.passed} passed</span>}
                          {ev.test_summary.failed > 0 && <span style={{ color: STATUS_COLOR.failed, marginLeft: 8 }}>{ev.test_summary.failed} failed</span>}
                          {ev.test_summary.skipped > 0 && <span style={{ color: '#6b7280', marginLeft: 8 }}>{ev.test_summary.skipped} skipped</span>}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
