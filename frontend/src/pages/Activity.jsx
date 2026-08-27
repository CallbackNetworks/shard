import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import { getActivity, getProjects } from '../api/client'
import { qk } from '../api/queryKeys'
import { BRAND, DARK, STATUS_COLOR } from '../constants/theme'
import { actionGroup, buildActivitySignals, bucketActivitySignals, summarizeActivitySignals } from '../utils/activitySignals'
import RuleOutcomeChips from '../components/shared/RuleOutcomeChips'
import { useRuleVocabulary } from '../hooks/useRuleVocabulary'
import { formatTimestamp, absoluteTime } from '../utils/datetime'
import { useUiPrefs } from '../utils/uiPrefs'
import useBreakpoint from '../hooks/useBreakpoint'

const PAGE_SIZE = 50

const ACTION_COLORS = {
  'task.created':        BRAND,
  'task.status_changed': BRAND,
  'task.assigned':       DARK.info,
  'task.deleted':        DARK.danger,
  'task.done':           STATUS_COLOR.done,
  'task.failed':         STATUS_COLOR.failed,
  'task.due_soon':       BRAND,
  'task.overdue':        STATUS_COLOR.failed,
  'project.created':     BRAND,
  'project.archived':    DARK.textDim,
  'project.complete':    STATUS_COLOR.done,
  'share.viewed':        DARK.textDim,
  'comment.created':     DARK.info,
  // Automation writes rule.executed / rule.skipped; rule.triggered is a *notification*
  // event and never reaches this feed. The two "it did not work" actions are warnings on
  // purpose — ADR-0050/0051 exist to make them visible, and textDim is the dimmest thing
  // on the page.
  'rule.executed':          BRAND,
  'rule.skipped':           DARK.warning,
  'rule.failed':            DARK.danger,
  'webhook.unmapped_status': DARK.warning,
}

/** A rule run that changed nothing is not the same event as one that did, so it does not
 *  get the same colour even though the action string is identical (ADR-0053). */
function entryColor(entry) {
  if (entry.action === 'rule.executed' && entry.meta?.effect_count === 0) return DARK.textDim
  return ACTION_COLORS[entry.action] || DARK.textDim
}

const ACTION_GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'project', label: 'Projects' },
  { key: 'comment', label: 'Comments' },
  { key: 'share', label: 'Share' },
  { key: 'rule', label: 'Rules' },
  { key: 'webhook', label: 'Webhooks' },
]

const chip = (active) => ({
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
  background: active ? 'rgba(250,204,21,0.12)' : 'rgba(var(--kt-ink-rgb), 0.04)',
  color: active ? BRAND : DARK.textMid,
  border: `1px solid ${active ? 'rgba(250,204,21,0.32)' : 'rgba(var(--kt-ink-rgb), 0.08)'}`,
  transition: 'all 0.15s',
})

const VIEW_MODES = ['log', 'timeline', 'wall']

function SignalMarker({ signal }) {
  return (
    <span
      className={`kt-activity-signal-marker is-${signal.marker}`}
      style={{ '--signal-color': signal.color }}
      title={`${signal.action} / ${signal.detail}`}
    />
  )
}

function ActivityTimeline({ signals, isMobile }) {
  const buckets = bucketActivitySignals(signals, isMobile ? 12 : 24)
  const max = Math.max(...buckets.map(bucket => bucket.count), 1)

  if (isMobile) {
    return (
      <div className="kt-activity-timeline-mobile">
        {signals.map(signal => (
          <article key={signal.id} className="kt-activity-timeline-row">
            <SignalMarker signal={signal} />
            <div>
              <strong>{signal.detail}</strong>
              <span>{signal.action}{signal.projectName ? ` / ${signal.projectName}` : ''}</span>
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="kt-activity-timeline-view">
      <div className="kt-activity-density">
        {buckets.map(bucket => (
          <span
            key={bucket.index}
            style={{ height: `${Math.max(8, (bucket.count / max) * 74)}%` }}
            title={`${bucket.count} events`}
          />
        ))}
      </div>
      <div className="kt-activity-rail">
        {signals.map(signal => (
          <button
            key={signal.id}
            className={`kt-activity-rail-marker is-${signal.marker}`}
            style={{ left: `${signal.position}%`, '--signal-color': signal.color }}
            title={`${signal.action} / ${signal.detail}`}
          >
            <span className="kt-sr-only">{signal.detail}</span>
          </button>
        ))}
      </div>
      <div className="kt-activity-timeline-feed">
        {signals.slice(0, 8).map(signal => (
          <article key={signal.id}>
            <SignalMarker signal={signal} />
            <div>
              <strong>{signal.detail}</strong>
              <span>{signal.action}{signal.projectName ? ` / ${signal.projectName}` : ''}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function ActivityWall({ signals }) {
  const groups = summarizeActivitySignals(signals)
  return (
    <div className="kt-activity-wall">
      {groups.map(group => (
        <section key={group.group} className="kt-activity-wall-panel">
          <div className="kt-activity-wall-head">
            <span>{group.group}</span>
            <b>{group.count}</b>
          </div>
          <div className="kt-activity-wall-grid">
            {signals.filter(signal => signal.group === group.group).slice(0, 18).map(signal => (
              <SignalMarker key={signal.id} signal={signal} />
            ))}
          </div>
          {group.latest && (
            <div className="kt-activity-wall-latest">
              <strong>{group.latest.detail}</strong>
              <span>{group.latest.projectName || group.latest.action}</span>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

export default function Activity() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  useUiPrefs() // re-render when timestamp/time-format preferences change
  const [projectFilter, setProjectFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [viewMode, setViewMode] = useState('log')
  const [page, setPage] = useState(0)

  const { data: projects = [] } = useQuery({
    queryKey: qk.projects(),
    queryFn: getProjects,
  })

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  if (projectFilter) params.project_id = projectFilter

  const { data: activities = [], isLoading } = useQuery({
    queryKey: qk.activity(projectFilter, page),
    queryFn: () => getActivity(params),
    keepPreviousData: true,
  })

  // An executed rule's actions are read back here in the same words the Rules page uses
  // to write them (ADR-0058); the same record shown two ways is a record nobody can match
  // to its rule.
  const ruleVocabulary = useRuleVocabulary()

  const filtered = actionFilter === 'all'
    ? activities
    : activities.filter(a => a.action.startsWith(actionFilter + '.'))

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const signals = buildActivitySignals(filtered, projectMap)
  const groupCounts = Object.fromEntries(ACTION_GROUPS.map(group => [
    group.key,
    group.key === 'all' ? activities.length : activities.filter(a => actionGroup(a) === group.key).length,
  ]))
  const latest = filtered[0]

  return (
    <div className="kt-page kt-activity-page">
      {/* Header */}
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('activity.title')}</h1>
          <div className="kt-page-subtitle">
            {filtered.length} events / {latest ? `${latest.action} ${formatTimestamp(latest.created_at)}` : 'no signal'}
          </div>
        </div>
        <ActivityIcon size={22} color={BRAND} />
      </div>

      <div className={isMobile ? 'kt-activity-shell kt-activity-shell-mobile' : 'kt-activity-shell'}>
        <aside className="kt-activity-console">
          <div className="kt-activity-console-title">
            <Filter size={13} />
            Signal Filter
          </div>
          <select
            value={projectFilter}
            onChange={e => { setProjectFilter(e.target.value); setPage(0) }}
            className="kt-input"
          >
            <option value="">{t('activity.allProjects')}</option>
            {projects.filter(p => p.status === 'active').map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div role="group" aria-label="Filter by type" className="kt-activity-filter-list">
            {ACTION_GROUPS.map(g => (
              <button
                key={g.key}
                onClick={() => { setActionFilter(g.key); setPage(0) }}
                style={chip(actionFilter === g.key)}
                className={actionFilter === g.key ? 'kt-activity-filter is-active' : 'kt-activity-filter'}
                aria-pressed={actionFilter === g.key}
              >
                <span>{g.label}</span>
                <b>{groupCounts[g.key] || 0}</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="kt-activity-log">
          <div className="kt-activity-view-toggle" role="group" aria-label="Activity view mode">
            {VIEW_MODES.map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={viewMode === mode ? 'is-active' : ''}
                aria-pressed={viewMode === mode}
              >
                {t(`activity.view.${mode}`)}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="kt-loading" style={{ minHeight: 220 }}>
              <span>{t('loading')}</span>
              <span>EVENTS</span>
              <span>SIGNAL</span>
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="kt-empty">
              <ActivityIcon size={32} className="kt-empty-icon" />
              <div className="kt-empty-title">{t('activity.noActivity')}</div>
            </div>
          )}

          {!isLoading && filtered.length > 0 && viewMode === 'timeline' && (
            <ActivityTimeline signals={signals} isMobile={isMobile} />
          )}

          {!isLoading && filtered.length > 0 && viewMode === 'wall' && (
            <ActivityWall signals={signals} />
          )}

          {!isLoading && filtered.length > 0 && viewMode === 'log' && (
            <div className="kt-activity-list">
              {filtered.map((entry, i) => {
                const color = entryColor(entry)
                const group = actionGroup(entry).toUpperCase()
                return (
                  <article key={entry.id || i} className="kt-activity-event" style={{ animationDelay: `${i * 0.035}s` }}>
                    <div className="kt-activity-event-index">{String(page * PAGE_SIZE + i + 1).padStart(2, '0')}</div>
                    <div className="kt-activity-event-body">
                      <div className="kt-activity-event-detail">
                        {entry.detail || entry.action}
                      </div>
                      <RuleOutcomeChips records={entry.meta?.actions} specs={ruleVocabulary?.action_values} />
                      <div className="kt-activity-event-meta">
                        <span className="kt-chip" style={{ color, borderColor: `${color}55` }}>{entry.action}</span>
                        <span>{group}</span>
                        {entry.project_id && projectMap[entry.project_id] && <span>{projectMap[entry.project_id]}</span>}
                        {entry.actor && <span>by {entry.actor}</span>}
                      </div>
                    </div>
                    <time className="kt-activity-event-time">
                      <span>{formatTimestamp(entry.created_at)}</span>
                      <small>{absoluteTime(entry.created_at)}</small>
                    </time>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>

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
