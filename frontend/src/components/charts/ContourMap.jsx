import { useMemo, useState } from 'react'
import { isOverdue } from '../../utils/overdue'

const LEVELS = 12            // contour lines between sea level and the highest summit
const INDEX_EVERY = 4        // every fourth line is an index contour, drawn heavier
const CELL = 6               // field resolution in viewBox units
const HOT = 0.95, COLD = 0.3 // line opacity at the hottest and the quietest mountain

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

const GRAIN_BUCKETS = 5

// Deterministic noise: the same map draws the same way on every refresh.
function hash(x, y) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return v - Math.floor(v)
}
function smooth(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
// Per piece of line: an opacity that drifts slowly along it, the odd gap, and the
// rarer piece knocked sideways — wear and misregistration, not static.
function grain(x, y, level) {
  const drift = smooth(x / 5 + level * 3.1, y / 5 - level * 1.7)
  const speck = hash(x * 3.3 + level, y * 2.9 - level)
  const bucket = Math.min(GRAIN_BUCKETS - 1, Math.floor((0.15 + 0.85 * drift * (0.7 + 0.3 * speck)) * GRAIN_BUCKETS))
  const drop = speck < 0.07
  const slip = hash(x + level * 7, y) < 0.025 ? (hash(y, x) - 0.5) * 1.6 : 0
  return { bucket, drop, slip }
}

// Join marching-squares segments into rings. Neighbouring cells compute a shared
// edge point from the same two samples, so endpoints match exactly.
function stitch(segs) {
  const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`
  const at = new Map()
  segs.forEach((s, i) => {
    for (const end of [0, 1]) {
      const k = key(s[end])
      if (!at.has(k)) at.set(k, [])
      at.get(k).push(i)
    }
  })
  const used = new Uint8Array(segs.length)
  const rings = []
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue
    used[start] = 1
    const ring = [segs[start][0], segs[start][1]]
    let tip = segs[start][1]
    for (;;) {
      const next = (at.get(key(tip)) || []).find(i => !used[i])
      if (next == null) break
      used[next] = 1
      const s = segs[next]
      tip = key(s[0]) === key(tip) ? s[1] : s[0]
      ring.push(tip)
    }
    if (ring.length > 3) rings.push(ring)
  }
  return rings
}

function TaskDot({ d, x, y, on, pickProps }) {
  const style = DOT[d.status]
  return (
    <g style={{ cursor: 'pointer' }} {...pickProps}>
      {/* A ring around the dot, not a recoloured dot: a late todo must not read as failed. */}
      {isOverdue(d.task) && <circle cx={x} cy={y} r={on ? 7 : 5} fill="none" stroke="var(--kt-status-failed, #fb7185)" strokeWidth={1} />}
      <circle cx={x} cy={y} r={on ? 4.5 : 2.6} fill={style.fill === 'none' ? 'var(--kt-bg, #0b0c0e)' : style.fill} stroke={style.stroke} strokeWidth={1}>
        <title>{d.task.title}</title>
      </circle>
    </g>
  )
}

function PeakLabel({ p, x, y, lineOpacity, pickProps }) {
  return (
    <g style={{ cursor: 'pointer' }} {...pickProps}>
      <path d={`M${x - 4},${y + 3} L${x},${y - 4} L${x + 4},${y + 3} Z`} fill="var(--kt-ink)" fillOpacity={lineOpacity(p.warmth)} />
      <text x={x} y={y - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--kt-ink)" fillOpacity={0.35 + 0.65 * p.warmth}
        style={{ paintOrder: 'stroke', stroke: 'var(--kt-bg, #0b0c0e)', strokeWidth: 3 }}>
        {p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name}
      </text>
    </g>
  )
}

const segPath = (segs, f) => segs.map(([ax, ay, bx, by]) => {
  const [x1, y1] = f(ax, ay), [x2, y2] = f(bx, by)
  return `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`
}).join('')

function Strokes({ level, f, lineOpacity, peaks }) {
  return level.strokes.map((st, k) => (
    <path
      key={k}
      d={segPath(st.segs, f)}
      fill="none"
      stroke="var(--kt-ink, #f5f6f7)"
      strokeOpacity={lineOpacity(peaks[st.owner]?.warmth ?? 0) * st.alpha * (level.index ? 1 : 0.7)}
      strokeWidth={level.index ? 1.3 : 0.75}
      strokeLinecap="round"
    />
  ))
}

// Top-down: the contour lines themselves.
function PlanView({ map, focus, pick, lineOpacity }) {
  const f = (x, y) => [x * CELL, y * CELL]
  return (
    <>
      {map.levels.map(level => <g key={level.l}><Strokes level={level} f={f} lineOpacity={lineOpacity} peaks={map.peaks} /></g>)}
      {map.dots.map(d => (
        <TaskDot key={d.task.id} d={d} x={d.x} y={d.y} on={focus?.kind === 'task' && focus.task.id === d.task.id} pickProps={pick('task', d)} />
      ))}
      {map.peaks.map(p => <PeakLabel key={p.id} p={p} x={p.x} y={p.y} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
    </>
  )
}

// Summits seen from the side line up along the horizon, so their names can land on
// top of each other. Nearer labels keep their place; a farther one steps up clear.
function spreadLabels(labels) {
  const placed = []
  for (const l of [...labels].sort((a, b) => b.y - a.y)) {
    let y = l.y
    for (const q of placed) if (Math.abs(q.x - l.x) < 150 && Math.abs(q.y - y) < 16) y = q.y - 16
    placed.push({ ...l, y })
  }
  return placed
}

const TILT = 0.55       // how flat the ground plane is drawn: 1 is top-down, 0 edge-on
const RISE = 0.3        // the tallest summit stands this fraction of the frame high

// In relief: every contour ring lifted to its own height, stacked from sea level
// up like terraces. Each ring is filled with the background, so a higher terrace
// hides the part of a lower one that is behind the hill; a task stands on the
// terrace beneath it.
function ReliefView({ map, focus, pick, lineOpacity, H }) {
  const { field, cols, rows, top, peaks, dots, levels } = map
  const lift = (H * RISE) / top
  const ground = H * (1 - TILT) * 0.8
  const px = (x, y, z) => [x, ground + y * TILT - z * lift]
  const height = (x, y) => {
    const i = Math.max(0, Math.min(cols - 1, Math.round(x / CELL)))
    const j = Math.max(0, Math.min(rows - 1, Math.round(y / CELL)))
    return field[j * cols + i]
  }

  // Pins stand on the surface but are drawn above every terrace, nearest last: a
  // pin's head rises into the terrace above it, and hiding it there would hide a
  // task in front of the hill, not behind it.
  const pins = dots.map(d => ({ d, z: height(d.x, d.y) })).sort((a, b) => a.d.y - b.d.y)
  const pin = ({ d, z }) => {
    const [x, y] = px(d.x, d.y, z)
    const on = focus?.kind === 'task' && focus.task.id === d.task.id
    return (
      <g key={d.task.id}>
        <line x1={x} y1={y} x2={x} y2={y - 9} stroke="rgba(var(--kt-ink-rgb), 0.5)" strokeWidth={0.8} />
        <TaskDot d={d} x={x} y={y - 9} on={on} pickProps={pick('task', d)} />
      </g>
    )
  }

  return (
    <>
      {levels.map(level => {
        const f = (x, y) => px(x * CELL, y * CELL, level.z)
        const fill = level.rings.map(r => r.map((p, i) => {
          const [x, y] = f(p[0], p[1])
          return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
        }).join('') + 'Z').join('')
        return (
          <g key={level.l}>
            <path d={fill} fill="var(--kt-bg, #0b0c0e)" fillOpacity={0.9} fillRule="nonzero" />
            <Strokes level={level} f={f} lineOpacity={lineOpacity} peaks={peaks} />
          </g>
        )
      })}
      {pins.map(pin)}
      {spreadLabels(peaks.map(p => {
        const [x, y] = px(p.x, p.y, height(p.x, p.y))
        return { p, x, y: y - 14 }
      })).map(({ p, x, y }) => <PeakLabel key={p.id} p={p} x={x} y={y} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
    </>
  )
}

/**
 * The share as one landscape: every project is a mountain whose size is its task
 * count, and whose contour lines are as bright as the project is busy. Tasks sit on
 * its slopes — in progress near the summit, done at the foot — and can be inspected.
 *
 * `projects`: `[{ id, name, tasks: [{ id, title, status, due_date, progress_pct }], heat }]`
 * where `heat` is a recent activity count.
 */
export default function ContourMap({ projects, width = 720, height = 420, emptyLabel = 'Nothing to map yet', initialView = 'relief' }) {
  const [focus, setFocus] = useState(null) // { kind: 'task' | 'peak', ... }
  const [view, setView] = useState(initialView) // 'relief' (2.5D) | 'plan' (top-down)
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

    // Contours are traced on a copy whose rim is sea level, so every ring closes.
    const sea = Float32Array.from(field)
    for (let i = 0; i < cols; i++) { sea[i] = 0; sea[(rows - 1) * cols + i] = 0 }
    for (let j = 0; j < rows; j++) { sea[j * cols] = 0; sea[j * cols + cols - 1] = 0 }

    // Per level: the rings (closed, for the relief's fills) and the strokes, cut into
    // pieces by owning mountain and by noise bucket. A piece keeps its owner's
    // warmth and gets its own opacity, so a line fades, breaks and slips like a
    // worn print instead of running solid.
    const levels = []
    for (let l = 1; l <= LEVELS; l++) {
      const z = (l / (LEVELS + 1)) * top
      const segs = contours(sea, cols, rows, z)
      const strokes = new Map()
      for (const [a, b] of segs) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const n = grain(mx, my, l)
        if (n.drop) continue
        const ci = Math.min(cols - 1, Math.round(mx)), cj = Math.min(rows - 1, Math.round(my))
        const k = owner[cj * cols + ci]
        const key = `${k}:${n.bucket}`
        if (!strokes.has(key)) strokes.set(key, { owner: k, alpha: (n.bucket + 0.5) / GRAIN_BUCKETS, segs: [] })
        strokes.get(key).segs.push([a[0] + n.slip, a[1], b[0] + n.slip, b[1]])
      }
      levels.push({ l, z, index: l % INDEX_EVERY === 0, rings: stitch(segs), strokes: [...strokes.values()] })
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
    return { peaks, levels, dots, field, cols, rows, top }
  }, [projects, W, H])

  if (!map) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.28)', fontSize: 12, padding: '18px 0' }}>{emptyLabel}</div>
  }

  const overdue = isOverdue

  const pick = (kind, d) => ({ onMouseEnter: () => setFocus({ kind, ...d }), onClick: () => setFocus({ kind, ...d }) })
  const lineOpacity = warmth => COLD + (HOT - COLD) * warmth

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, marginTop: -6, marginBottom: 4 }}>
        {[['relief', '2.5D'], ['plan', 'Map']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            style={{
              padding: '3px 9px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer',
              border: '1px solid var(--kt-line)',
              background: view === key ? 'rgba(var(--kt-ink-rgb), 0.14)' : 'transparent',
              color: view === key ? 'var(--kt-ink)' : 'var(--kt-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={map.peaks.map(p => `${p.name}: ${p.tasks.length} tasks, ${p.heat} recent updates`).join('; ')}
        onClick={e => { if (e.target === e.currentTarget) setFocus(null) }}
        style={{ display: 'block' }}
      >
        {view === 'plan'
          ? <PlanView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} />
          : <ReliefView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} H={H} />}
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
