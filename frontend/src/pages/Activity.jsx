import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import { getActivity, getProjects } from '../api/client'
import { DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const PAGE_SIZE = 50

const ACTION_COLORS = {
  'task.created':        DARK.success,
  'task.status_changed': DARK.warning,
  'task.assigned':       DARK.info,
  'task.deleted':        DARK.danger,
  'task.done':           DARK.success,
  'task.failed':         DARK.danger,
  'task.due_soon':       DARK.warning,
  'task.overdue':        '#ff5533',
  'project.created':     DARK.success,
  'project.archived':    DARK.textDim,
  'project.complete':    DARK.success,
  'share.viewed':        DARK.textDim,
  'comment.created':     DARK.info,
  'rule.triggered':      '#dda0dd',
}

const ACTION_GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'project', label: 'Projects' },
  { key: 'comment', label: 'Comments' },
  { key: 'share', label: 'Share' },
  { key: 'rule', label: 'Rules' },
]

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const sel = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: DARK.text,
  outline: 'none',
}

const chip = (active) => ({
  borderRadius: 9999,
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
  background: active ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.04)',
  color: active ? DARK.success : DARK.textMid,
  border: `1px solid ${active ? 'rgba(30,215,96,0.3)' : 'rgba(255,255,255,0.08)'}`,
  transition: 'all 0.15s',
})

export default function Activity() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [projectFilter, setProjectFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [page, setPage] = useState(0)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  if (projectFilter) params.project_id = projectFilter

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activity', projectFilter, page],
    queryFn: () => getActivity(params),
    keepPreviousData: true,
  })

  const filtered = actionFilter === 'all'
    ? activities
    : activities.filter(a => a.action.startsWith(actionFilter + '.'))

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 40px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        flexWrap: 'wrap',
      }}>
        <ActivityIcon size={20} color={DARK.success} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: DARK.text }}>
          {t('activity.title')}
        </h2>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <Filter size={14} color={DARK.textDim} />
        <select
          value={projectFilter}
          onChange={e => { setProjectFilter(e.target.value); setPage(0) }}
          style={sel}
        >
          <option value="">{t('activity.allProjects')}</option>
          {projects.filter(p => p.status === 'active').map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Action type chips */}
      <div role="group" aria-label="Filter by type" style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {ACTION_GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => { setActionFilter(g.key); setPage(0) }}
            style={chip(actionFilter === g.key)}
            aria-pressed={actionFilter === g.key}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
          {t('loading')}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
          {t('activity.noActivity')}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: isMobile ? 20 : 28 }}>
          {/* Timeline line */}
          <div style={{
            position: 'absolute', left: isMobile ? 7 : 11, top: 8, bottom: 8,
            width: 1, background: 'rgba(255,255,255,0.06)',
          }} />

          {filtered.map((entry, i) => {
            const color = ACTION_COLORS[entry.action] || DARK.textDim
            return (
              <div key={entry.id || i} style={{
                position: 'relative', padding: '10px 0',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                {/* Dot */}
                <div style={{
                  position: 'absolute', left: isMobile ? -17 : -21,
                  top: 14, width: 9, height: 9, borderRadius: '50%',
                  background: color, boxShadow: `0 0 6px ${color}44`,
                }} />

                <div style={{
                  display: 'flex', flexDirection: isMobile ? 'column' : 'row',
                  gap: isMobile ? 4 : 12, alignItems: isMobile ? 'flex-start' : 'center',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, color: DARK.text, lineHeight: 1.4,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {entry.detail || entry.action}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color,
                        background: `${color}18`, padding: '1px 6px',
                        borderRadius: 4, letterSpacing: '0.04em',
                      }}>
                        {entry.action}
                      </span>
                      {entry.project_id && projectMap[entry.project_id] && (
                        <span style={{ fontSize: 10, color: DARK.textDim }}>
                          {projectMap[entry.project_id]}
                        </span>
                      )}
                      {entry.actor && (
                        <span style={{ fontSize: 10, color: DARK.textDim }}>
                          by {entry.actor}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 11, color: DARK.textDim, flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                    display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'flex-start' : 'flex-end',
                    gap: 2,
                  }}>
                    <span>{relativeTime(entry.created_at)}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
                      {formatTime(entry.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 12, marginTop: 20,
          alignItems: 'center',
        }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              ...chip(false), opacity: page === 0 ? 0.3 : 1,
              cursor: page === 0 ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <ChevronLeft size={14} /> {t('previous')}
          </button>
          <span style={{ fontSize: 11, color: DARK.textDim }}>
            {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + filtered.length}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={activities.length < PAGE_SIZE}
            style={{
              ...chip(false), opacity: activities.length < PAGE_SIZE ? 0.3 : 1,
              cursor: activities.length < PAGE_SIZE ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {t('next')} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
