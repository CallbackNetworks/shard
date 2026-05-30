import { useState, useEffect } from 'react'
import { DARK } from '../constants/theme'

export const FONT = '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif'
export const BG   = '#121212'
export const LINE = 'rgba(255,255,255,0.06)'
export const DIM  = 'rgba(255,255,255,0.22)'
export const MID  = 'rgba(255,255,255,0.55)'
export const HI   = '#e2e4f0'

/* ── Geometry helpers ──────────────────────────────────────────────── */
// Right-lean parallelogram: top-right straight, bottom-right cut
const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`
// Left-lean parallelogram: top-left cut, bottom-left straight
const PARA_L = (px = 14) => `polygon(${px}px 0, 100% 0, 100% 100%, 0 100%)`
// Full parallelogram (both sides)
const PARA   = (px = 10) => `polygon(${px}px 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

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
  if (u > 0.55) return '#ff5533'
  if (u > 0.28) return '#f0b429'
  if (u > 0.08) return '#1ed760'
  return '#1ed760'
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
export function Bar({ pct, color, height = 5, bg = 'rgba(255,255,255,0.05)' }) {
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
    <div style={{ width: '100%', height, display: 'flex', background: 'rgba(255,255,255,0.04)', clipPath: PARA_R(offset) }}>
      <div style={{ width: `${d}%`, height: '100%', background: '#22c55e', transition: 'width 0.04s' }} />
      <div style={{ width: `${a}%`, height: '100%', background: '#38bdf8', transition: 'width 0.04s' }} />
      <div style={{ width: `${f}%`, height: '100%', background: '#f87171', transition: 'width 0.04s' }} />
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
      background: active ? 'rgba(30,215,96,0.1)' : 'transparent',
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
      background: 'rgba(255,255,255,0.018)',
      borderTop: '1px solid rgba(255,255,255,0.07)',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
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
export function ViewProgress({ projects }) {
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
                <span style={{
                  fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                }}>
                  {p.name}
                </span>
                {overdue > 0 && <Label color="#ff5533">⚠ {overdue} overdue</Label>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color, letterSpacing: '-0.04em', lineHeight: 1 }}>
                  {pct}<span style={{ fontSize: 11, fontWeight: 500, color: DIM }}>%</span>
                </span>
                <span style={{ fontSize: 11, color: DIM }}>{done}/{total}</span>
              </div>
            </div>
            <Bar pct={pct} color={color} height={6} />
          </GlassRow>
        )
      })}
    </div>
  )
}

/* ── ViewHealth ────────────────────────────────────────────────────── */
export function ViewHealth({ projects }) {
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', gap: 20, paddingBottom: 14, marginBottom: 4 }}>
        {[['#22c55e', 'DONE'], ['#38bdf8', 'ACTIVE'], ['#f87171', 'FAILED']].map(([c, l]) => (
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
        const uLabel  = u > 0.55 ? 'URGENT' : u > 0.28 ? 'WARNING' : u > 0.08 ? 'CAUTION' : 'HEALTHY'
        return (
          <GlassRow key={p.id} accentColor={color}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: DIM }}>{total} tasks</span>
                <Label color={color}>{uLabel}</Label>
              </div>
            </div>
            <StackedBar done={done} active={active} failed={failed} total={total} height={12} />
            <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
              {[['#22c55e', done, 'done'], ['#38bdf8', active, 'active'], ['#f87171', failed, 'failed']].map(([c, n, l]) => (
                <span key={l} style={{ fontSize: 11, color: n > 0 ? c : 'rgba(255,255,255,0.15)', fontWeight: 700, letterSpacing: '0.04em' }}>
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
const STATUS_COLOR = { done: '#22c55e', in_progress: '#38bdf8', failed: '#f87171', todo: 'rgba(255,255,255,0.2)' }
const STATUS_LABEL = { done: 'DONE', in_progress: 'ACTIVE', failed: 'FAILED', todo: 'TODO' }
const PRI_COLOR    = { high: '#f87171', medium: '#f0b429', low: '#1ed760' }

export function ViewTasks({ projects }) {
  const [open, setOpen] = useState({})
  return (
    <div style={{ paddingTop: 8 }}>
      {projects.map(p => {
        const tasks  = p.tasks || []
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
                background: 'rgba(255,255,255,0.025)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                clipPath: PARA_R(14),
                cursor: 'pointer', userSelect: 'none',
                position: 'relative',
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, color: DIM }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: HI, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{p.name}</span>
              </div>
              <span style={{ fontSize: 11, color: DIM }}>{tasks.length} tasks</span>
            </div>
            {/* Task rows */}
            {isOpen && tasks.map((t, i) => {
              const sc = STATUS_COLOR[t.status] || DIM
              const isOverdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 20px 8px 32px',
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.008)' : 'transparent',
                  borderLeft: `2px solid ${sc}22`,
                }}>
                  <span style={{
                    width: 8, height: 8, flexShrink: 0,
                    background: sc,
                    clipPath: PARA(3),
                  }} />
                  <span style={{
                    flex: 1, fontSize: 12,
                    color: t.status === 'done' ? 'rgba(255,255,255,0.2)' : MID,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: t.status === 'done' ? 'line-through' : 'none',
                  }}>
                    {t.title}
                  </span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    {isOverdue && <Label color="#ff5533">OVERDUE</Label>}
                    <span style={{ fontSize: 10, fontWeight: 700, color: PRI_COLOR[t.priority] || DIM, letterSpacing: '0.06em' }}>
                      {(t.priority || '').toUpperCase()}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: sc, letterSpacing: '0.06em',
                      minWidth: 48, textAlign: 'right',
                    }}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
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

/* ── ViewCompare ───────────────────────────────────────────────────── */
export function ViewCompare({ projects }) {
  const cols = ['TOTAL', 'DONE', 'ACT', 'FAIL', 'OVD', 'PCT']
  return (
    <div style={{ paddingTop: 8 }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr repeat(6, 52px)',
        padding: '8px 20px 8px 24px',
        background: 'rgba(255,255,255,0.03)',
        clipPath: PARA_R(14),
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 9, color: DIM, letterSpacing: '0.14em', fontWeight: 800 }}>PROJECT</span>
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
        const vColors = [MID, '#22c55e', '#38bdf8', failed > 0 ? '#f87171' : DIM, overdue > 0 ? '#ff5533' : DIM, color]
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
