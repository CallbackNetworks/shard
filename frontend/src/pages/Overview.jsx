import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProjects, getIdentities, getIdentityProjects } from '../api/client'

const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "SF Mono", monospace'
const BG   = '#0a0a0c'
const LINE = 'rgba(255,255,255,0.06)'
const DIM  = 'rgba(255,255,255,0.18)'
const MID  = 'rgba(255,255,255,0.45)'
const HI   = '#e8e8f0'

/* ── urgency ─────────────────────────────────────────────────────── */
function urgencyScore(project) {
  const tasks = project.tasks || []
  if (!tasks.length) return 0
  const total   = tasks.length
  const failed  = tasks.filter(t => t.status === 'failed').length
  const highIp  = tasks.filter(t => t.priority === 'high' && t.status === 'in_progress').length
  const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
  return Math.min(1, (failed * 2 + highIp * 1.5 + overdue * 1.2) / (total * 2))
}
function urgencyColor(u) {
  if (u > 0.55) return '#ff5533'
  if (u > 0.28) return '#f0b429'
  if (u > 0.08) return '#34d399'
  return '#7c7cff'
}

/* ── count-up ────────────────────────────────────────────────────── */
function useCountUp(target, ms = 700) {
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

/* ── flat progress bar ───────────────────────────────────────────── */
function Bar({ pct, color, height = 4, bg = 'rgba(255,255,255,0.06)' }) {
  const anim = useCountUp(pct)
  return (
    <div style={{ width: '100%', height, background: bg, position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, height: '100%',
        width: `${anim}%`, background: color,
        transition: 'width 0.04s linear',
      }} />
    </div>
  )
}

/* ── stacked bar ─────────────────────────────────────────────────── */
function StackedBar({ done, active, failed, total, height = 12 }) {
  const pDone   = total ? (done   / total) * 100 : 0
  const pActive = total ? (active / total) * 100 : 0
  const pFailed = total ? (failed / total) * 100 : 0
  const d = useCountUp(Math.round(pDone))
  const a = useCountUp(Math.round(pActive))
  const f = useCountUp(Math.round(pFailed))
  return (
    <div style={{ width: '100%', height, display: 'flex', background: 'rgba(255,255,255,0.04)' }}>
      <div style={{ width: `${d}%`, height: '100%', background: '#22c55e', transition: 'width 0.04s' }} />
      <div style={{ width: `${a}%`, height: '100%', background: '#38bdf8', transition: 'width 0.04s' }} />
      <div style={{ width: `${f}%`, height: '100%', background: '#f87171', transition: 'width 0.04s' }} />
    </div>
  )
}

/* ── label ───────────────────────────────────────────────────────── */
function Label({ children, color }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', color,
      border: `1px solid ${color}55`,
      padding: '1px 5px',
    }}>{children}</span>
  )
}

/* ══ VIEW: PROGRESS ══════════════════════════════════════════════ */
function ViewProgress({ projects }) {
  return (
    <div>
      {projects.map(p => {
        const pct     = Math.round(p.progress || 0)
        const u       = urgencyScore(p)
        const color   = urgencyColor(u)
        const tasks   = p.tasks || []
        const done    = tasks.filter(t => t.status === 'done').length
        const total   = p.total_tasks || 0
        const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
        return (
          <div key={p.id} style={{ borderBottom: `1px solid ${LINE}`, padding: '18px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ width: 3, height: 14, background: color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: HI, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name.toUpperCase()}
                </span>
                {overdue > 0 && <Label color="#ff5533">⚠ {overdue} OVERDUE</Label>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{pct}<span style={{ fontSize: 11, fontWeight: 500, color: DIM }}>%</span></span>
                <span style={{ fontSize: 11, color: DIM }}>{done}/{total}</span>
              </div>
            </div>
            <Bar pct={pct} color={color} height={6} />
          </div>
        )
      })}
    </div>
  )
}

/* ══ VIEW: HEALTH ════════════════════════════════════════════════ */
function ViewHealth({ projects }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 20, paddingBottom: 16, borderBottom: `1px solid ${LINE}` }}>
        {[['#22c55e', 'DONE'], ['#38bdf8', 'ACTIVE'], ['#f87171', 'FAILED']].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: DIM, fontWeight: 600, letterSpacing: '0.08em' }}>
            <span style={{ width: 10, height: 4, background: c }} />{l}
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
        const uLabel  = u > 0.55 ? 'URGENT' : u > 0.28 ? 'WARNING' : u > 0.08 ? 'CAUTION' : 'HEALTHY'
        return (
          <div key={p.id} style={{ borderBottom: `1px solid ${LINE}`, padding: '16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ width: 3, height: 14, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: HI, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name.toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: DIM }}>{total} tasks</span>
                <Label color={color}>{uLabel}</Label>
              </div>
            </div>
            <StackedBar done={done} active={active} failed={failed} total={total} height={14} />
            <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
              {[['#22c55e', done, 'done'], ['#38bdf8', active, 'active'], ['#f87171', failed, 'failed']].map(([c, n, l]) => (
                <span key={l} style={{ fontSize: 11, color: n > 0 ? c : 'rgba(255,255,255,0.15)', fontWeight: 600 }}>
                  {n} {l.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ══ VIEW: TASKS ═════════════════════════════════════════════════ */
const STATUS_COLOR = { done: '#22c55e', in_progress: '#38bdf8', failed: '#f87171', todo: 'rgba(255,255,255,0.2)' }
const STATUS_LABEL = { done: 'DONE', in_progress: 'ACTIVE', failed: 'FAILED', todo: 'TODO' }
const PRI_COLOR    = { high: '#f87171', medium: '#f0b429', low: '#7c7cff' }

function ViewTasks({ projects }) {
  const [open, setOpen] = useState({})
  return (
    <div>
      {projects.map(p => {
        const tasks  = p.tasks || []
        const isOpen = open[p.id] !== false
        const u      = urgencyScore(p)
        const color  = urgencyColor(u)
        return (
          <div key={p.id} style={{ borderBottom: `1px solid ${LINE}` }}>
            <div
              onClick={() => setOpen(s => ({ ...s, [p.id]: !isOpen }))}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', cursor: 'pointer', userSelect: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: DIM, fontWeight: 600, letterSpacing: '0.06em' }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ width: 3, height: 14, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: HI, letterSpacing: '0.04em' }}>{p.name.toUpperCase()}</span>
              </div>
              <span style={{ fontSize: 11, color: DIM }}>{tasks.length} tasks</span>
            </div>
            {isOpen && tasks.map(t => {
              const sc = STATUS_COLOR[t.status] || DIM
              const isOverdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0 7px 26px', borderTop: `1px solid ${LINE}` }}>
                  <span style={{ width: 6, height: 6, background: sc, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, color: t.status === 'done' ? 'rgba(255,255,255,0.25)' : MID, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                    {t.title}
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {isOverdue && <Label color="#ff5533">OVERDUE</Label>}
                    <span style={{ fontSize: 10, fontWeight: 700, color: PRI_COLOR[t.priority] || DIM, letterSpacing: '0.06em' }}>{(t.priority || '').toUpperCase()}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: sc, letterSpacing: '0.06em', minWidth: 44, textAlign: 'right' }}>{STATUS_LABEL[t.status] || t.status}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ══ VIEW: COMPARE ═══════════════════════════════════════════════ */
function ViewCompare({ projects }) {
  const cols = ['TOTAL', 'DONE', 'ACTIVE', 'FAILED', 'OVERDUE', 'PCT']
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(6, 56px)', borderBottom: `1px solid ${LINE}`, paddingBottom: 10 }}>
        <span style={{ fontSize: 9, color: DIM, letterSpacing: '0.12em', fontWeight: 700 }}>PROJECT</span>
        {cols.map(c => <span key={c} style={{ fontSize: 9, color: DIM, letterSpacing: '0.12em', fontWeight: 700, textAlign: 'right' }}>{c}</span>)}
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
        const vColors = [MID, '#22c55e', '#38bdf8', failed > 0 ? '#f87171' : DIM, overdue > 0 ? '#ff5533' : DIM, color]
        return (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr repeat(6, 56px)', borderBottom: `1px solid ${LINE}`, padding: '14px 0', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 3, height: 14, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: HI, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name.toUpperCase()}
              </span>
            </div>
            {vals.map((v, i) => (
              <span key={i} style={{ fontSize: 14, fontWeight: 700, color: vColors[i], textAlign: 'right', letterSpacing: '-0.01em' }}>{v}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ── Tab button ──────────────────────────────────────────────────── */
function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '6px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
      color: active ? HI : DIM,
      borderBottom: `2px solid ${active ? '#7c7cff' : 'transparent'}`,
      transition: 'color 0.15s, border-color 0.15s',
      fontFamily: FONT,
    }}>{label}</button>
  )
}

/* ── Identity filter button ──────────────────────────────────────── */
function IdentityBtn({ identity, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '3px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      color: active ? identity.color : DIM,
      borderBottom: `2px solid ${active ? identity.color : 'transparent'}`,
      transition: 'color 0.15s, border-color 0.15s',
      fontFamily: FONT,
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{ width: 6, height: 6, background: active ? identity.color : DIM }} />
      {identity.name.toUpperCase()}
    </button>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Overview() {
  const [view, setView] = useState('progress')
  const [now, setNow]   = useState(new Date())
  const [copied, setCopied] = useState(false)

  // Read identity filter from URL
  const [identityId, setIdentityId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('identity') || null
  })

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // Update URL when identity changes (no page reload)
  const selectIdentity = (id) => {
    const url = id ? `?identity=${id}` : window.location.pathname
    window.history.pushState({}, '', id ? `${window.location.pathname}?identity=${id}` : window.location.pathname)
    setIdentityId(id)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Always fetch identities (for the switcher)
  const { data: identities = [] } = useQuery({
    queryKey: ['identities'],
    queryFn: getIdentities,
    refetchInterval: 30000,
  })

  // Fetch all projects OR identity-scoped projects
  const { data: allProjects = [], isLoading: loadingAll } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    refetchInterval: 30000,
    enabled: !identityId,
  })
  const { data: identityProjects = [], isLoading: loadingIdentity } = useQuery({
    queryKey: ['identity-projects', identityId],
    queryFn: () => getIdentityProjects(identityId),
    refetchInterval: 30000,
    enabled: !!identityId,
  })

  const isLoading = identityId ? loadingIdentity : loadingAll
  const rawProjects = identityId ? identityProjects : allProjects
  const active = rawProjects.filter(p => p.status === 'active')

  const currentIdentity = identities.find(i => i.id === identityId) || null

  const totalTasks  = active.reduce((s, p) => s + (p.total_tasks || 0), 0)
  const doneTasks   = active.reduce((s, p) => s + (p.done_tasks  || 0), 0)
  const overallPct  = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0
  const urgentCount = active.filter(p => urgencyScore(p) > 0.55).length
  const timeStr     = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr     = now.toLocaleDateString([], { month: 'short', day: 'numeric' })

  const VIEWS = [
    { key: 'progress', label: 'PROGRESS' },
    { key: 'health',   label: 'HEALTH'   },
    { key: 'tasks',    label: 'TASKS'    },
    { key: 'compare',  label: 'COMPARE'  },
  ]

  return (
    <div style={{
      minHeight: '100vh', background: BG, fontFamily: FONT, color: HI,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: active.length === 0 && !isLoading ? 'center' : 'flex-start',
    }}>
      <div style={{ width: '100%', maxWidth: 760, padding: '48px 32px 64px' }}>

        {/* ── Top meta row ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
          <div>
            {/* Identity scope indicator */}
            {currentIdentity ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, background: currentIdentity.color }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: currentIdentity.color, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  {currentIdentity.name}
                </span>
                <span style={{ fontSize: 10, color: DIM, letterSpacing: '0.12em' }}>· PROJECT STATUS</span>
              </div>
            ) : (
              <div style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 6 }}>
                Project Status
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: DIM }}>
                <span style={{ color: HI, fontWeight: 700 }}>{active.length}</span> projects
              </span>
              <span style={{ fontSize: 11, color: DIM }}>
                <span style={{ color: HI, fontWeight: 700 }}>{totalTasks}</span> tasks
              </span>
              <span style={{ fontSize: 11, color: DIM }}>
                <span style={{ color: '#7c7cff', fontWeight: 700 }}>{overallPct}%</span> overall
              </span>
              {urgentCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#ff5533' }}>⚠ {urgentCount} urgent</span>
              )}
            </div>
          </div>

          {/* Right: date + copy link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            {identityId && (
              <button onClick={copyLink} style={{
                background: 'none', border: `1px solid ${copied ? '#34d399' : LINE}`,
                cursor: 'pointer', padding: '3px 10px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                color: copied ? '#34d399' : DIM, fontFamily: FONT,
                transition: 'color 0.2s, border-color 0.2s',
              }}>
                {copied ? '✓ COPIED' : '⎘ COPY LINK'}
              </button>
            )}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.12)', letterSpacing: '0.06em' }}>
              {dateStr} {timeStr}
            </span>
          </div>
        </div>

        {/* ── Identity switcher ── */}
        {identities.length > 0 && (
          <div style={{ display: 'flex', gap: 20, marginBottom: 20, borderBottom: `1px solid ${LINE}`, paddingBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={() => selectIdentity(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '3px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: !identityId ? HI : DIM,
              borderBottom: `2px solid ${!identityId ? '#7c7cff' : 'transparent'}`,
              fontFamily: FONT,
            }}>ALL</button>
            {identities.map(ident => (
              <IdentityBtn
                key={ident.id}
                identity={ident}
                active={identityId === ident.id}
                onClick={() => selectIdentity(ident.id)}
              />
            ))}
          </div>
        )}

        {/* ── Global progress bar ── */}
        <div style={{ marginBottom: 28 }}>
          <Bar pct={overallPct} color={currentIdentity?.color || '#7c7cff'} height={2} bg="rgba(255,255,255,0.05)" />
        </div>

        {/* ── View tabs ── */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 4, borderBottom: `1px solid ${LINE}` }}>
          {VIEWS.map(v => (
            <TabBtn key={v.key} label={v.label} active={view === v.key} onClick={() => setView(v.key)} />
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ paddingTop: 4 }}>
          {isLoading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: DIM, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Loading…
            </div>
          )}
          {!isLoading && active.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: DIM, fontSize: 11, letterSpacing: '0.12em' }}>
              {identityId ? 'No active projects for this identity' : 'No active projects'}
            </div>
          )}
          {!isLoading && active.length > 0 && view === 'progress' && <ViewProgress projects={active} />}
          {!isLoading && active.length > 0 && view === 'health'   && <ViewHealth   projects={active} />}
          {!isLoading && active.length > 0 && view === 'tasks'    && <ViewTasks    projects={active} />}
          {!isLoading && active.length > 0 && view === 'compare'  && <ViewCompare  projects={active} />}
        </div>

      </div>
    </div>
  )
}
