import { useMemo, useState } from 'react'
import { isOverdue } from '../../utils/overdue'

const LEVELS = 12            // contour lines between sea level and the highest summit
const INDEX_EVERY = 4        // every fourth line is an index contour, drawn heavier
const CELL = 6               // field resolution in viewBox units
const HOT = 0.95, COLD = 0.14 // line opacity at the hottest and the quietest mountain

const DOT = {
  in_progress: { r: 0.32, fill: 'var(--kt-ink)', stroke: 'none' },
  todo: { r: 0.72, fill: 'rgba(var(--kt-ink-rgb), 0.45)', stroke: 'none' },
  failed: { r: 0.95, fill: 'var(--kt-status-failed, #fb7185)', stroke: 'none' },
  done: { r: 1.25, fill: 'none', stroke: 'rgba(var(--kt-ink-rgb), 0.45)' },
}

// Where each mountain stands. Biggest first, on a golden-angle spiral, then pushed
// apart until no two footprints overlap: deterministic, so the map does not move
// between refreshes, and the largest project ends up in the middle.
export function placeMountains(items, W, H) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const spots = items.map((m, i) => {
    const r = Math.sqrt(i) * m.sigma * 2.2
    return { ...m, x: W / 2 + Math.cos(i * golden) * r, y: H / 2 + Math.sin(i * golden) * r * 0.75 }
  })
  for (let pass = 0; pass < 80; pass++) {
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const A = spots[a], B = spots[b]
        const dx = B.x - A.x, dy = B.y - A.y
        const d = Math.hypot(dx, dy) || 0.01
        // Far enough apart that a saddle forms between two summits instead of one blob.
        const min = (A.sigma + B.sigma) * 1.55
        if (d < min) {
          const push = (min - d) / 2
          A.x -= (dx / d) * push; A.y -= (dy / d) * push
          B.x += (dx / d) * push; B.y += (dy / d) * push
        }
      }
    }
  }
  // Fit the whole range inside the frame with a margin of one footprint.
  const xs = spots.flatMap(s => [s.x - s.sigma * 2.2, s.x + s.sigma * 2.2])
  const ys = spots.flatMap(s => [s.y - s.sigma * 2.2, s.y + s.sigma * 2.2])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const k = Math.min(W / (maxX - minX), H / (maxY - minY))
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k
  return spots.map(s => ({ ...s, x: s.x * k + ox, y: s.y * k + oy, sigma: s.sigma * k }))
}

// Marching squares over a sampled field. Each segment remembers which mountain owns
// the ground it crosses, so a ridge between two projects is drawn in two brightnesses.
function contours(field, cols, rows, level) {
  const segs = []
  const lerp = (a, b) => (level - a) / (b - a)
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = field[j * cols + i], tr = field[j * cols + i + 1]
      const br = field[(j + 1) * cols + i + 1], bl = field[(j + 1) * cols + i]
      const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const top = [i + lerp(tl, tr), j], right = [i + 1, j + lerp(tr, br)]
      const bottom = [i + lerp(bl, br), j + 1], left = [i, j + lerp(tl, bl)]
      const pairs = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
        5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]],
        9: [[top, bottom]], 10: [[top, right], [left, bottom]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      }[idx]
      for (const p of pairs) segs.push(p)
    }
  }
  return segs
}

/**
 * The share as one landscape: every project is a mountain whose size is its task
 * count, and whose contour lines are as bright as the project is busy. Tasks sit on
 * its slopes — in progress near the summit, done at the foot — and can be inspected.
 *
 * `projects`: `[{ id, name, tasks: [{ id, title, status, due_date, progress_pct }], heat }]`
 * where `heat` is a recent activity count.
 */
export default function ContourMap({ projects, width = 720, height = 420, emptyLabel = 'Nothing to map yet' }) {
  const [focus, setFocus] = useState(null) // { kind: 'task' | 'peak', ... }
  const W = width, H = height

  const map = useMemo(() => {
    const live = projects.filter(p => p.tasks.length > 0)
    if (live.length === 0) return null
    const maxTasks = Math.max(...live.map(p => p.tasks.length))
    const maxHeat = Math.max(1, ...live.map(p => p.heat))
    const base = Math.min(W, H) * (live.length === 1 ? 0.2 : 0.13)
    const items = [...live]
      .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
      .map(p => {
        const size = p.tasks.length / maxTasks
        return { ...p, peak: 0.25 + 0.75 * size, sigma: base * (0.55 + 0.45 * Math.sqrt(size)), warmth: p.heat / maxHeat }
      })
    const peaks = placeMountains(items, W, H)

    const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1
    const field = new Float32Array(cols * rows)
    const owner = new Int16Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL, y = j * CELL
        let sum = 0, best = -1, bestV = 0
        peaks.forEach((p, k) => {
          const v = p.peak * Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * p.sigma ** 2))
          sum += v
          if (v > bestV) { bestV = v; best = k }
        })
        field[j * cols + i] = sum
        owner[j * cols + i] = best
      }
    }
    const top = Math.max(...field)

    // One path per (level, owning mountain), so a line changes brightness where it
    // crosses from one project's ground to another's.
    const lines = []
    for (let l = 1; l <= LEVELS; l++) {
      const level = (l / (LEVELS + 1)) * top
      const byOwner = new Map()
      for (const [a, b] of contours(field, cols, rows, level)) {
        const ci = Math.min(cols - 1, Math.round((a[0] + b[0]) / 2))
        const cj = Math.min(rows - 1, Math.round((a[1] + b[1]) / 2))
        const k = owner[cj * cols + ci]
        const d = `M${(a[0] * CELL).toFixed(1)},${(a[1] * CELL).toFixed(1)}L${(b[0] * CELL).toFixed(1)},${(b[1] * CELL).toFixed(1)}`
        byOwner.set(k, (byOwner.get(k) || '') + d)
      }
      for (const [k, d] of byOwner) lines.push({ key: `${l}-${k}`, d, index: l % INDEX_EVERY === 0, warmth: peaks[k]?.warmth ?? 0 })
    }

    // Tasks on the slopes: a ring per status, spread evenly around the summit.
    const dots = peaks.flatMap(p => {
      const groups = {}
      for (const t of p.tasks) (groups[t.status in DOT ? t.status : 'todo'] ||= []).push(t)
      return Object.entries(groups).flatMap(([status, list]) =>
        list.map((t, i) => {
          const angle = (i / list.length) * Math.PI * 2 + p.x * 0.01 + DOT[status].r
          const r = p.sigma * DOT[status].r
          return { task: t, project: p.name, status, x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r * 0.8 }
        }))
    })
    return { peaks, lines, dots }
  }, [projects, W, H])

  if (!map) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.28)', fontSize: 12, padding: '18px 0' }}>{emptyLabel}</div>
  }

  const overdue = t => isOverdue(t)

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={map.peaks.map(p => `${p.name}: ${p.tasks.length} tasks, ${p.heat} recent updates`).join('; ')}
        onClick={e => { if (e.target === e.currentTarget) setFocus(null) }}
        style={{ display: 'block' }}
      >
        {map.lines.map(l => (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke="var(--kt-ink, #f5f6f7)"
            strokeOpacity={(COLD + (HOT - COLD) * l.warmth) * (l.index ? 1 : 0.6)}
            strokeWidth={l.index ? 1.3 : 0.7}
            strokeLinecap="round"
          />
        ))}

        {map.dots.map(d => {
          const style = DOT[d.status]
          const late = overdue(d.task)
          const on = focus?.kind === 'task' && focus.task.id === d.task.id
          return (
            <g key={d.task.id}>
            {/* A ring around the dot, not a recoloured dot: a late todo must not read as failed. */}
            {late && <circle cx={d.x} cy={d.y} r={on ? 7 : 5} fill="none" stroke="var(--kt-status-failed, #fb7185)" strokeWidth={1} />}
            <circle
              cx={d.x}
              cy={d.y}
              r={on ? 4.5 : 2.6}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setFocus({ kind: 'task', ...d })}
              onClick={() => setFocus({ kind: 'task', ...d })}
            >
              <title>{d.task.title}</title>
            </circle>
            </g>
          )
        })}

        {map.peaks.map(p => (
          <g
            key={p.id}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setFocus({ kind: 'peak', ...p })}
            onClick={() => setFocus({ kind: 'peak', ...p })}
          >
            <path d={`M${p.x - 4},${p.y + 3} L${p.x},${p.y - 4} L${p.x + 4},${p.y + 3} Z`} fill="var(--kt-ink)" fillOpacity={COLD + (HOT - COLD) * p.warmth} />
            <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--kt-ink)" fillOpacity={0.35 + 0.65 * p.warmth}
              style={{ paintOrder: 'stroke', stroke: 'var(--kt-bg, #0b0c0e)', strokeWidth: 3 }}>
              {p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name}
            </text>
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6, color: 'var(--kt-muted)', fontSize: 10, textTransform: 'uppercase' }}>
        {[['in_progress', 'in progress · summit'], ['todo', 'todo'], ['failed', 'failed'], ['done', 'done · foot']].map(([k, label]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill={DOT[k].fill} stroke={DOT[k].stroke} /></svg>
            {label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="2" fill="rgba(var(--kt-ink-rgb), 0.45)" /><circle cx="6" cy="6" r="5" fill="none" stroke="var(--kt-status-failed, #fb7185)" /></svg>
          overdue
        </span>
      </div>

      {focus && (
        <div
          role="status"
          style={{
            position: 'absolute', left: 8, top: 8, maxWidth: 'min(320px, calc(100% - 16px))',
            padding: '8px 10px', border: '1px solid var(--kt-line)', background: 'rgba(var(--kt-bg-rgb), 0.94)',
            fontSize: 12, lineHeight: 1.45, pointerEvents: 'none',
          }}
        >
          {focus.kind === 'peak' ? (
            <>
              <b style={{ color: 'var(--kt-ink)' }}>{focus.name}</b>
              <div style={{ color: 'var(--kt-muted)' }}>
                {focus.tasks.length} tasks · {focus.tasks.filter(t => t.status === 'done').length} done · {focus.heat} updates in 30 days
              </div>
            </>
          ) : (
            <>
              <b style={{ color: 'var(--kt-ink)' }}>{focus.task.title}</b>
              <div style={{ color: 'var(--kt-muted)' }}>
                {focus.project} · {focus.status.replace('_', ' ')}
                {focus.task.progress_pct != null && ` · ${focus.task.progress_pct}%`}
                {focus.task.due_date && ` · due ${new Date(focus.task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
                {overdue(focus.task) && <span style={{ color: 'var(--kt-status-failed, #fb7185)' }}> · overdue</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
