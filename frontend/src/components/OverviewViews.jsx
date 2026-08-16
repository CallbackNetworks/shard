import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DARK, STATUS_COLOR, PRIORITY } from '../constants/theme'
import { formatMinutes } from '../utils/formatTime'
import { formatTimestamp } from '../utils/datetime'
import QuickAddTask from './overview/QuickAddTask'
import PinButton from './overview/PinButton'

export const FONT = '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif'
export const BG   = '#121212'
export const LINE = 'rgba(var(--kt-ink-rgb), 0.06)'
export const DIM  = 'rgba(var(--kt-ink-rgb), 0.22)'
export const MID  = 'rgba(var(--kt-ink-rgb), 0.55)'
export const HI   = 'var(--kt-ink)'

/* ── Geometry helpers ──────────────────────────────────────────────── */
// Right-lean parallelogram: top-right straight, bottom-right cut
const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`
// Left-lean parallelogram: top-left cut, bottom-left straight
const PARA_L = (px = 14) => `polygon(${px}px 0, 100% 0, 100% 100%, 0 100%)`
// Full parallelogram (both sides)
const PARA   = (px = 10) => `polygon(${px}px 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

// Preference-aware timestamp (relative vs. absolute, 12/24h). See utils/datetime.
const relativeTime = formatTimestamp

// Pin storage moved to components/overview/pinnedProjects (re-exported for Dashboard).
export { getPinnedIds, togglePin } from './overview/pinnedProjects'

// The active i18n locale, not a hardcoded 'en': the whole page translates and
// then printed "Jul 22" beside it (ADR-0088).
function formatDate(dateStr, locale) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
}

export function urgencyScore(project) {
  const tasks = project.tasks || []
  if (!tasks.length) return 0
  const total   = tasks.length
  const failed  = tasks.filter(t => t.status === 'failed').length
  const highIp  = tasks.filter(t => t.priority === 'high' && t.status === 'in_progress').length
  const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
  return Math.min(1, (failed * 2 + highIp * 1.5 + overdue * 1.2) / (total * 2))
}

export function urgencyColor(u) {
  if (u > 0.55) return STATUS_COLOR.failed
  if (u > 0.28) return '#f0b429'
  if (u > 0.08) return STATUS_COLOR.in_progress
  return '#facc15'
}

export function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!target) { setV(0); return }
    const t0 = Date.now()
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms)
      setV(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p >= 1) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [target, ms])
  return v
}

/* ── Bar — flat parallelogram progress bar ─────────────────────────── */
export function Bar({ pct, color, height = 5, bg = 'rgba(var(--kt-ink-rgb), 0.05)' }) {
  const anim = useCountUp(pct)
  return (
    <div style={{
      width: '100%', height, background: bg,
      position: 'relative', clipPath: PARA_R(height * 1.5),
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, height: '100%',
        width: `${anim}%`, background: color,
        transition: 'width 0.04s linear',
        clipPath: PARA_R(height * 1.5),
      }} />
    </div>
  )
}

/* ── Stacked bar — parallelogram ───────────────────────────────────── */
export function StackedBar({ done, active, failed, total, height = 14 }) {
  const pDone   = total ? (done   / total) * 100 : 0
  const pActive = total ? (active / total) * 100 : 0
  const pFailed = total ? (failed / total) * 100 : 0
  const d = useCountUp(Math.round(pDone))
  const a = useCountUp(Math.round(pActive))
  const f = useCountUp(Math.round(pFailed))
  const offset = height * 1.2
  return (
    <div style={{ width: '100%', height, display: 'flex', background: 'rgba(var(--kt-ink-rgb), 0.04)', clipPath: PARA_R(offset) }}>
      <div style={{ width: `${d}%`, height: '100%', background: STATUS_COLOR.done, transition: 'width 0.04s' }} />
      <div style={{ width: `${a}%`, height: '100%', background: STATUS_COLOR.in_progress, transition: 'width 0.04s' }} />
      <div style={{ width: `${f}%`, height: '100%', background: STATUS_COLOR.failed, transition: 'width 0.04s' }} />
    </div>
  )
}

/* ── Label — skewed badge ──────────────────────────────────────────── */
export function Label({ children, color }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
      textTransform: 'uppercase', color,
      background: `${color}18`,
      border: `1px solid ${color}44`,
      padding: '2px 7px',
      transform: 'skewX(-6deg)',
    }}>
      <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>{children}</span>
    </span>
  )
}

/* ── Tab button — parallelogram ────────────────────────────────────── */
export function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'rgba(250,204,21,0.1)' : 'transparent',
      border: 'none',
      borderTop: `2px solid ${active ? DARK.success : 'transparent'}`,
      cursor: 'pointer',
      padding: '8px 18px',
      fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
      color: active ? HI : DIM,
      transform: 'skewX(-6deg)',
      transition: 'color 0.15s, background 0.15s',
      fontFamily: FONT,
      outline: 'none',
    }}>
      <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>{label}</span>
    </button>
  )
}

/* ── Glass panel wrapper ───────────────────────────────────────────── */
function GlassRow({ children, accentColor, style = {} }) {
  return (
    <div style={{
      position: 'relative',
      background: 'rgba(var(--kt-ink-rgb), 0.018)',
      borderTop: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
      borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.03)',
      margin: '6px 0',
      padding: '16px 20px 16px 24px',
      clipPath: PARA_R(18),
      ...style,
    }}>
      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: accentColor || DARK.success,
        clipPath: PARA_L(0),
      }} />
      {children}
    </div>
  )
}

/* ── ViewProgress ──────────────────────────────────────────────────── */
export function ViewProgress({ projects, pinned, onTogglePin }) {
  return (
    <div style={{ paddingTop: 8 }}>
      {projects.map(p => {
        const pct     = Math.round(p.progress || 0)
        const u       = urgencyScore(p)
        const color   = urgencyColor(u)
        const tasks   = p.tasks || []
        const done    = tasks.filter(t => t.status === 'done').length
        const total   = p.total_tasks || 0
        const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
        return (
          <GlassRow key={p.id} accentColor={color}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <PinButton projectId={p.id} pinned={pinned} onToggle={onTogglePin} />
                <span style={{
                  fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                }}>
                  {p.name}
                </span>
                {overdue > 0 && <Label color={STATUS_COLOR.failed}>! {overdue} overdue</Label>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.15)', fontVariantNumeric: 'tabular-nums' }}>
                  {relativeTime(p.updated_at)}
                </span>
                <span style={{ fontSize: 24, fontWeight: 900, color, letterSpacing: '-0.04em', lineHeight: 1 }}>
                  {pct}<span style={{ fontSize: 11, fontWeight: 500, color: DIM }}>%</span>
                </span>
                <span style={{ fontSize: 11, color: DIM }}>{done}/{total}</span>
              </div>
            </div>
            {p.description && (
              <div style={{
                fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)', marginBottom: 8,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500,
              }}>
                {p.description}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}><Bar pct={pct} color={color} height={6} /></div>
              <QuickAddTask projectId={p.id} />
            </div>
          </GlassRow>
        )
      })}
    </div>
  )
}

/* ── ViewHealth ────────────────────────────────────────────────────── */
export function ViewHealth({ projects, pinned, onTogglePin }) {
  const { t } = useTranslation()
  const legend = [
    [STATUS_COLOR.done, t('overview.colDone')],
    [STATUS_COLOR.in_progress, t('overview.colActive')],
    [STATUS_COLOR.failed, t('overview.colFailed')],
  ]
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', gap: 20, paddingBottom: 14, marginBottom: 4 }}>
        {legend.map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.1em' }}>
            <span style={{ width: 12, height: 4, background: c, clipPath: PARA(4) }} />{l}
          </span>
        ))}
      </div>
      {projects.map(p => {
        const tasks   = p.tasks || []
        const done    = tasks.filter(t => t.status === 'done').length
        const active  = tasks.filter(t => t.status === 'in_progress').length
        const failed  = tasks.filter(t => t.status === 'failed').length
        const total   = p.total_tasks || 0
        const u       = urgencyScore(p)
        const color   = urgencyColor(u)
        const uLabel  = t(u > 0.55 ? 'overview.urgent' : u > 0.28 ? 'overview.warning' : u > 0.08 ? 'overview.caution' : 'overview.healthy')
        return (
          <GlassRow key={p.id} accentColor={color}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <PinButton projectId={p.id} pinned={pinned} onToggle={onTogglePin} />
                <span style={{ fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.15)', fontVariantNumeric: 'tabular-nums' }}>{relativeTime(p.updated_at)}</span>
                <span style={{ fontSize: 11, color: DIM }}>{total} tasks</span>
                <Label color={color}>{uLabel}</Label>
              </div>
            </div>
            {p.description && (
              <div style={{
                fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)', marginBottom: 8,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500,
              }}>
                {p.description}
              </div>
            )}
            <StackedBar done={done} active={active} failed={failed} total={total} height={12} />
            <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
              {[[STATUS_COLOR.done, done, 'done'], [STATUS_COLOR.in_progress, active, 'active'], [STATUS_COLOR.failed, failed, 'failed']].map(([c, n, l]) => (
                <span key={l} style={{ fontSize: 11, color: n > 0 ? c : 'rgba(var(--kt-ink-rgb), 0.15)', fontWeight: 700, letterSpacing: '0.04em' }}>
                  {n} <span style={{ fontWeight: 400, opacity: 0.6 }}>{l}</span>
                </span>
              ))}
            </div>
          </GlassRow>
        )
      })}
    </div>
  )
}

/* ── ViewTasks ─────────────────────────────────────────────────────── */
const STATUS_COLOR_MAP = STATUS_COLOR
const STATUS_LABEL_KEY = { done: 'done', in_progress: 'inProgress', failed: 'failed', todo: 'todo' }

export function ViewTasks({ projects }) {
  // `t` is the map callback's task in this file, so the translator is `tr`.
  const { t: tr, i18n } = useTranslation()
  const locale = i18n.language
  const [open, setOpen] = useState({})
  const [expandedTask, setExpandedTask] = useState(null)
  return (
    <div style={{ paddingTop: 8 }}>
      {projects.map(p => {
        const allTasks = p.tasks || []
        const topTasks = allTasks.filter(t => !t.parent_id)
        const isOpen = open[p.id] !== false
        const u      = urgencyScore(p)
        const color  = urgencyColor(u)
        return (
          <div key={p.id} style={{ marginBottom: 6 }}>
            {/* Project header row */}
            <div
              onClick={() => setOpen(s => ({ ...s, [p.id]: !isOpen }))}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px 12px 24px',
                background: 'rgba(var(--kt-ink-rgb), 0.025)',
                borderTop: '1px solid rgba(var(--kt-ink-rgb), 0.08)',
                clipPath: PARA_R(14),
                cursor: 'pointer', userSelect: 'none',
                position: 'relative',
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: DIM }}>{isOpen ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{p.name}</span>
                </div>
                {p.description && (
                  <div style={{
                    fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)', marginTop: 2, marginLeft: 20,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500,
                  }}>
                    {p.description}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, color: DIM, flexShrink: 0 }}>{topTasks.length} tasks</span>
            </div>
            {/* Task rows */}
            {isOpen && topTasks.map((t, i) => {
              const sc = STATUS_COLOR_MAP[t.status] || DIM
              const isOverdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()
              const isExpanded = expandedTask === t.id
              const subtasks = allTasks.filter(sub => sub.parent_id === t.id)
              const hasDetail = t.description || t.progress_pct != null || t.start_date ||
                t.time_estimate || t.time_spent || subtasks.length > 0 ||
                (t.blocked_by && t.blocked_by.length > 0) || (t.blocking && t.blocking.length > 0)
              return (
                <div key={t.id}>
                  <div
                    onClick={hasDetail ? () => setExpandedTask(isExpanded ? null : t.id) : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 20px 8px 32px',
                      background: i % 2 === 0 ? 'rgba(var(--kt-ink-rgb), 0.008)' : 'transparent',
                      borderLeft: `2px solid ${sc}22`,
                      cursor: hasDetail ? 'pointer' : 'default',
                      transition: 'background 0.15s',
                    }}
                  >
                    {hasDetail && (
                      <span style={{ fontSize: 9, color: DIM, flexShrink: 0, width: 8 }}>
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    )}
                    <span style={{
                      width: 8, height: 8, flexShrink: 0,
                      background: sc,
                      clipPath: PARA(3),
                    }} />
                    <span style={{
                      flex: 1, fontSize: 12,
                      color: t.status === 'done' ? 'rgba(var(--kt-ink-rgb), 0.2)' : MID,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: t.status === 'done' ? 'line-through' : 'none',
                    }}>
                      {t.title}
                    </span>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                      {isOverdue && <Label color={STATUS_COLOR.failed}>{tr('overview.overdueTag')}</Label>}
                      <span style={{ fontSize: 10, fontWeight: 700, color: (PRIORITY[t.priority] || {}).color || DIM, letterSpacing: '0.06em' }}>
                        {PRIORITY[t.priority] ? tr(PRIORITY[t.priority].labelKey) : t.priority}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: sc, letterSpacing: '0.06em',
                        minWidth: 48, textAlign: 'right',
                      }}>
                        {STATUS_LABEL_KEY[t.status] ? tr(STATUS_LABEL_KEY[t.status]) : t.status}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div style={{
                      padding: '10px 20px 12px 52px',
                      background: 'rgba(var(--kt-ink-rgb), 0.015)',
                      borderLeft: `2px solid ${sc}33`,
                      borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.04)',
                    }}>
                      {t.description && (
                        <div style={{
                          fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.4)', lineHeight: 1.5, marginBottom: 8,
                        }}>
                          {t.description.length > 200 ? t.description.slice(0, 200) + '...' : t.description}
                        </div>
                      )}

                      {/* Metadata row */}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, fontSize: 11 }}>
                        {t.start_date && (
                          <span style={{ color: DIM }}>{tr('overview.startLabel')} <span style={{ color: MID }}>{formatDate(t.start_date, locale)}</span></span>
                        )}
                        {t.due_date && (
                          <span style={{ color: DIM }}>{tr('overview.dueLabel')} <span style={{ color: isOverdue ? STATUS_COLOR.failed : MID }}>{formatDate(t.due_date, locale)}</span></span>
                        )}
                        {t.progress_pct != null && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 60 }}>
                              <Bar pct={t.progress_pct} color={sc} height={3} bg="rgba(var(--kt-ink-rgb), 0.06)" />
                            </span>
                            <span style={{ color: MID, fontSize: 11 }}>{t.progress_pct}%</span>
                          </span>
                        )}
                        {(t.time_estimate || t.time_spent) && (
                          <span style={{ color: DIM }}>
                            Time: <span style={{ color: MID }}>{formatMinutes(t.time_spent || 0)}</span>
                            {t.time_estimate && <span> / {formatMinutes(t.time_estimate)} est</span>}
                          </span>
                        )}
                      </div>

                      {/* Subtask list */}
                      {subtasks.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
                            textTransform: 'uppercase', color: DIM, marginBottom: 4,
                          }}>
                            SUBTASKS ({subtasks.length})
                          </div>
                          {subtasks.map(s => {
                            const sColor = STATUS_COLOR_MAP[s.status] || DIM
                            return (
                              <div key={s.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '3px 0', fontSize: 11,
                              }}>
                                <span style={{
                                  width: 6, height: 6, flexShrink: 0,
                                  background: sColor, clipPath: PARA(2),
                                }} />
                                <span style={{
                                  flex: 1, color: s.status === 'done' ? 'rgba(var(--kt-ink-rgb), 0.2)' : 'rgba(var(--kt-ink-rgb), 0.45)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  textDecoration: s.status === 'done' ? 'line-through' : 'none',
                                }}>
                                  {s.title}
                                </span>
                                <span style={{
                                  fontSize: 9, fontWeight: 700, color: sColor,
                                  letterSpacing: '0.06em', flexShrink: 0,
                                }}>
                                  {STATUS_LABEL_KEY[s.status] ? tr(STATUS_LABEL_KEY[s.status]) : s.status}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Dependencies */}
                      {(t.blocked_by?.length > 0 || t.blocking?.length > 0) && (
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
                          {t.blocked_by?.length > 0 && (
                            <span style={{ color: '#ffa42b' }}>
                              Blocked by: {t.blocked_by.map(id => {
                                const blocker = allTasks.find(bt => bt.id === id)
                                return blocker ? blocker.title : id.slice(-8)
                              }).join(', ')}
                            </span>
                          )}
                          {t.blocking?.length > 0 && (
                            <span style={{ color: STATUS_COLOR.in_progress }}>
                              Blocking: {t.blocking.map(id => {
                                const blocked = allTasks.find(bt => bt.id === id)
                                return blocked ? blocked.title : id.slice(-8)
                              }).join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ── ViewCompare ───────────────────────────────────────────────────── */
export function ViewCompare({ projects }) {
  const { t } = useTranslation()
  const cols = ['overview.colTotal', 'overview.colDone', 'overview.colActive', 'overview.colFailed', 'overview.colOverdue', 'overview.colPct'].map(k => t(k))
  return (
    <div style={{ paddingTop: 8 }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr repeat(6, 52px)',
        padding: '8px 20px 8px 24px',
        background: 'rgba(var(--kt-ink-rgb), 0.03)',
        clipPath: PARA_R(14),
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 9, color: DIM, letterSpacing: '0.14em', fontWeight: 800 }}>{t('overview.colProject')}</span>
        {cols.map(c => (
          <span key={c} style={{ fontSize: 9, color: DIM, letterSpacing: '0.12em', fontWeight: 800, textAlign: 'right' }}>{c}</span>
        ))}
      </div>
      {projects.map(p => {
        const tasks   = p.tasks || []
        const done    = tasks.filter(t => t.status === 'done').length
        const active  = tasks.filter(t => t.status === 'in_progress').length
        const failed  = tasks.filter(t => t.status === 'failed').length
        const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
        const total   = p.total_tasks || 0
        const pct     = Math.round(p.progress || 0)
        const u       = urgencyScore(p)
        const color   = urgencyColor(u)
        const vals    = [total, done, active, failed, overdue, `${pct}%`]
        const vColors = [MID, STATUS_COLOR.done, STATUS_COLOR.in_progress, failed > 0 ? STATUS_COLOR.failed : DIM, overdue > 0 ? STATUS_COLOR.failed : DIM, color]
        return (
          <GlassRow key={p.id} accentColor={color} style={{ padding: '12px 20px 12px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(6, 52px)', alignItems: 'center' }}>
              <span style={{
                fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.05em',
                textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.name}
              </span>
              {vals.map((v, i) => (
                <span key={i} style={{ fontSize: 15, fontWeight: 800, color: vColors[i], textAlign: 'right', letterSpacing: '-0.02em' }}>{v}</span>
              ))}
            </div>
          </GlassRow>
        )
      })}
    </div>
  )
}
