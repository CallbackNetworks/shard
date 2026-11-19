import { useMemo, useState } from 'react'
import { isOverdue } from '../../utils/overdue'

const LEVELS = 28            // contour lines between sea level and the highest summit
const INDEX_EVERY = 5        // every fifth line is an index contour, drawn heavier
const CELL = 8               // field resolution: coarse enough that contours turn corners
const HOT = 1, COLD = 0.4 // line opacity at the hottest and the quietest mountain

// `r` is where on the slope a status sits (a fraction of the mountain's spread);
// the rest is the mark: a small square, filled or open, and done shrinks to a point.
const DOT = {
  in_progress: { r: 0.32, size: 3, fill: 'var(--kt-ink)', stroke: 'none' },
  todo: { r: 0.72, size: 3, fill: 'none', stroke: 'rgba(var(--kt-ink-rgb), 0.6)' },
  failed: { r: 0.95, size: 3, fill: 'var(--kt-status-failed, #fb7185)', stroke: 'none' },
  done: { r: 1.25, size: 1.4, fill: 'rgba(var(--kt-ink-rgb), 0.4)', stroke: 'none' },
}
const LATE = 'var(--kt-status-failed, #fb7185)'
// Closed is done or failed (ADR-0089): neither is work still to climb.
const CLOSED = new Set(['done', 'failed'])

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
// A stable number in [0, 1) from a string, so a project's silhouette is its own.
function idSeed(id) {
  let h = 2166136261
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) / 4294967296
}

// Ridged noise: 1 on a crest, falling away sharply either side of it.
function ridged(x, y) {
  return 1 - Math.abs(smooth(x, y) * 2 - 1)
}
// Per piece of line: an opacity that drifts slowly along it, the odd gap, and the
// rarer piece knocked sideways — wear and misregistration, not static.
function grain(x, y, level) {
  const drift = smooth(x / 5 + level * 3.1, y / 5 - level * 1.7)
  const speck = hash(x * 3.3 + level, y * 2.9 - level)
  const bucket = Math.min(GRAIN_BUCKETS - 1, Math.floor((0.15 + 0.85 * drift * (0.7 + 0.3 * speck)) * GRAIN_BUCKETS))
  const drop = speck < 0.2
  const slip = hash(x + level * 7, y) < 0.1 ? (hash(y, x) - 0.5) * 3.6 : 0
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
      {/* Late is the outline turning red, not a recoloured fill: a late todo must not read as failed. */}
      <rect
        x={x - (on ? 3 : style.size / 2)} y={y - (on ? 3 : style.size / 2)}
        width={on ? 6 : style.size} height={on ? 6 : style.size}
        fill={style.fill}
        stroke={isOverdue(d.task) ? LATE : style.stroke}
        strokeWidth={0.7}
      />
      {/* The mark is small; the target under the pointer is not. */}
      <circle cx={x} cy={y} r={7} fill="transparent">
        <title>{d.task.title}</title>
      </circle>
    </g>
  )
}

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

// Ground position as map reference: easting left to right, northing back to front,
// 0–100 across the frame, so a label can be read against the edge ticks.
const gridRef = (x, y, W, H) => `E${(x / W * 100).toFixed(1).padStart(4, '0')} N${((1 - y / H) * 100).toFixed(1).padStart(4, '0')}`

// A summit: a crosshair on the peak, a leader line, and a two-line monospaced
// readout — name, then grid reference · tasks · recent activity.
function PeakLabel({ p, x, y, W, H, lineOpacity, pickProps }) {
  const bright = 0.4 + 0.6 * p.warmth
  const name = (p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name).toUpperCase()
  const data = `${gridRef(p.x, p.y, W, H)} · ${String(p.open).padStart(2, '0')}/${String(p.tasks.length).padStart(2, '0')} OPEN · ${String(p.heat).padStart(3, '0')} ACT`
  // A monospaced glyph is ~0.6em wide, so the readout's width is known before it
  // is drawn; one that would run off the right edge hangs to the left instead.
  const wide = Math.max(name.length * 6, data.length * 5.1) + 18
  const left = x + wide > W - 4
  const dir = left ? -1 : 1
  const lx = x + 14 * dir, ly = y - 16
  const anchor = left ? 'end' : 'start'
  const halo = { paintOrder: 'stroke', stroke: 'var(--kt-bg, #0b0c0e)', strokeWidth: 3 }
  return (
    <g style={{ cursor: 'pointer' }} {...pickProps} fontFamily={MONO}>
      <g stroke="var(--kt-ink)" strokeOpacity={lineOpacity(p.warmth)} strokeWidth={0.8}>
        <line x1={x - 6} y1={y} x2={x - 2} y2={y} /><line x1={x + 2} y1={y} x2={x + 6} y2={y} />
        <line x1={x} y1={y - 6} x2={x} y2={y - 2} /><line x1={x} y1={y + 2} x2={x} y2={y + 6} />
        <polyline points={`${x + 3 * dir},${y - 3} ${lx - 4 * dir},${ly + 4} ${lx + 2 * dir},${ly + 4}`} fill="none" strokeOpacity={0.45 * bright} />
      </g>
      <text x={lx + 4 * dir} y={ly} textAnchor={anchor} fontSize={10} fontWeight={700} letterSpacing={0.4} fill="var(--kt-ink)" fillOpacity={bright} style={halo}>
        {name}
      </text>
      <text x={lx + 4 * dir} y={ly + 11} textAnchor={anchor} fontSize={8.5} fill="var(--kt-ink)" fillOpacity={0.35 + 0.4 * p.warmth} style={halo}>
        {data}
      </text>
    </g>
  )
}

// The ground graticule: faint crosses at every grid intersection and numbered
// ticks along the front and left edges, drawn through `f` so the relief can lay
// them on its tilted ground plane and its terraces can cover them.
function Graticule({ f, W, H }) {
  // Tenths of the frame, so the tick numbers are the grid reference's own units.
  const xs = [], ys = []
  for (let k = 1; k < 10; k++) { xs.push((W * k) / 10); ys.push((H * k) / 10) }
  const cross = (x, y) => {
    const [cx, cy] = f(x, y)
    return `M${cx - 2.5},${cy}L${cx + 2.5},${cy}M${cx},${cy - 2.5}L${cx},${cy + 2.5}`
  }
  const tick = (a, b) => { const [x1, y1] = f(...a), [x2, y2] = f(...b); return `M${x1},${y1}L${x2},${y2}` }
  const [fx0, fy0] = f(0, H), [fx1, fy1] = f(W, H), [bx0, by0] = f(0, 0)
  return (
    <g fontFamily={MONO} fontSize={7.5} fill="rgba(var(--kt-ink-rgb), 0.35)" pointerEvents="none">
      <path d={xs.flatMap(x => ys.map(y => cross(x, y))).join('')} stroke="rgba(var(--kt-ink-rgb), 0.16)" strokeWidth={0.6} />
      <path d={`M${bx0},${by0}L${fx0},${fy0}L${fx1},${fy1}`} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.18)" strokeWidth={0.6} />
      <path d={xs.map(x => tick([x, H], [x, H - 8])).join('') + ys.map(y => tick([0, y], [8, y])).join('')} stroke="rgba(var(--kt-ink-rgb), 0.3)" strokeWidth={0.6} />
      {xs.map(x => { const [tx, ty] = f(x, H); return <text key={`x${x}`} x={tx} y={ty + 10 < H - 2 ? ty + 10 : ty - 11} textAnchor="middle">{String(Math.round(x / W * 100)).padStart(2, '0')}</text> })}
      {ys.map(y => { const [tx, ty] = f(0, y); return <text key={`y${y}`} x={tx + 11} y={ty + 2.5}>{String(Math.round((1 - y / H) * 100)).padStart(2, '0')}</text> })}
    </g>
  )
}

// Corner brackets and a readout, in screen space: the frame of the instrument,
// not part of the ground.
function Frame({ W, H, peaks, levels, view }) {
  const c = 12
  const corners = [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]]
  const tasks = peaks.reduce((n, p) => n + p.tasks.length, 0)
  const act = peaks.reduce((n, p) => n + p.heat, 0)
  return (
    <g pointerEvents="none" fontFamily={MONO}>
      <path
        d={corners.map(([x, y, dx, dy]) => `M${x + dx * 0.5},${y + dy * c}L${x + dx * 0.5},${y + dy * 0.5}L${x + dx * c},${y + dy * 0.5}`).join('')}
        fill="none" stroke="rgba(var(--kt-ink-rgb), 0.45)" strokeWidth={1}
      />
      <text x={W - 6} y={H - 6} textAnchor="end" fontSize={8} fill="rgba(var(--kt-ink-rgb), 0.4)">
        {`${view === 'plan' ? 'PLAN' : 'RELIEF'} · SITES ${String(peaks.length).padStart(2, '0')} · TSK ${String(tasks).padStart(3, '0')} · ACT/30D ${String(act).padStart(4, '0')} · LVL ${levels.length}`}
      </text>
    </g>
  )
}

// Screen-space tears: a few thin horizontal bands of the picture are shifted
// sideways, the way a signal drops a line. Chosen by band, so a tear cuts across
// every contour it crosses at once.
const TEAR_BAND = 7
function tear(x, y) {
  const band = Math.floor(y / TEAR_BAND)
  const h = hash(band * 1.31, 9.7)
  return h < 0.16 ? x + (hash(band, 3.3) - 0.5) * 30 : x
}

const segPath = (segs, f, dx = 0) => segs.map(([ax, ay, bx, by]) => {
  const [x1, y1] = f(ax, ay), [x2, y2] = f(bx, by)
  return `M${(tear(x1, y1) + dx).toFixed(1)},${y1.toFixed(1)}L${(tear(x2, y2) + dx).toFixed(1)},${y2.toFixed(1)}`
}).join('')

// Each stroke is drawn three times: the line, and a red and a cyan ghost a pixel
// either side of it — the misregistered colour fringe of a projected display.
const FRINGE = [
  { dx: -1.6, color: 'rgb(255, 70, 90)', share: 0.6, cls: 'kt-fringe-r' },
  { dx: 1.6, color: 'rgb(80, 220, 255)', share: 0.6, cls: 'kt-fringe-c' },
]

function Strokes({ level, f, lineOpacity, peaks }) {
  const width = level.index ? 0.8 : 0.45
  return level.strokes.map((st, k) => {
    // Thinner lines read darker at the same opacity, so they carry more of it.
    const opacity = Math.min(1, lineOpacity(peaks[st.owner]?.warmth ?? 0) * (0.35 + 0.65 * st.alpha) * (level.index ? 1.25 : 0.95))
    return (
      <g key={k}>
        {FRINGE.map(fr => (
          <path key={fr.cls} className={fr.cls} d={segPath(st.segs, f, fr.dx)} fill="none" stroke={fr.color}
            strokeOpacity={opacity * fr.share} strokeWidth={width} strokeLinecap="butt" />
        ))}
        <path d={segPath(st.segs, f)} fill="none" stroke="var(--kt-ink, #f5f6f7)" strokeOpacity={opacity} strokeWidth={width} strokeLinecap="butt" />
      </g>
    )
  })
}

// Top-down: the contour lines themselves.
function PlanView({ map, focus, pick, lineOpacity, W, H }) {
  const f = (x, y) => [x * CELL, y * CELL]
  return (
    <>
      <Graticule f={(x, y) => [x, y]} W={W} H={H} />
      {map.levels.map(level => <g key={level.l}><Strokes level={level} f={f} lineOpacity={lineOpacity} peaks={map.peaks} /></g>)}
      {map.dots.map(d => (
        <TaskDot key={d.task.id} d={d} x={d.x} y={d.y} on={focus?.kind === 'task' && focus.task.id === d.task.id} pickProps={pick('task', d)} />
      ))}
      {map.peaks.map(p => <PeakLabel key={p.id} p={p} x={p.x} y={p.y} W={W} H={H} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
    </>
  )
}

// Summits seen from the side line up along the horizon, so their names can land on
// top of each other. Nearer labels keep their place; a farther one steps up clear.
function spreadLabels(labels) {
  const placed = []
  for (const l of [...labels].sort((a, b) => b.y - a.y)) {
    let y = l.y
    for (const q of placed) if (Math.abs(q.x - l.x) < 200 && Math.abs(q.y - y) < 26) y = q.y - 26
    placed.push({ ...l, y })
  }
  return placed
}

const TILT = 0.62       // how flat the ground plane is drawn: 1 is top-down, 0 edge-on
const RISE = 0.22       // the tallest summit stands this fraction of the frame high

// In relief: every contour ring lifted to its own height, stacked from sea level
// up like terraces. Each ring is filled with the background, so a higher terrace
// hides the part of a lower one that is behind the hill; a task stands on the
// terrace beneath it.
function ReliefView({ map, focus, pick, lineOpacity, W, H }) {
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
        <TaskDot d={d} x={x} y={y - 1.5} on={on} pickProps={pick('task', d)} />
      </g>
    )
  }

  return (
    <>
      <Graticule f={(x, y) => px(x, y, 0)} W={W} H={H} />
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
        // On the highest ring actually drawn near this summit, not on the spike above
        // it that nothing outlines.
        const near = (p.sigma * 0.6) / CELL
        const z = levels.findLast(lv => lv.strokes.some(st => st.segs.some(([ax, ay]) =>
          Math.hypot(ax - p.x / CELL, ay - p.y / CELL) < near)))?.z ?? 0
        const [x, y] = px(p.x, p.y, z)
        return { p, x, y }
      })).map(({ p, x, y }) => <PeakLabel key={p.id} p={p} x={x} y={y} W={W} H={H} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
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
    // Two measures, so two projects of one size can still look different:
    //   width  = every task the project holds — its footprint, the whole of the work;
    //   height = the tasks still open — how much climbing is left.
    // A big project that is mostly done is broad and low; a new one is narrow and
    // steep. A finished project is a low plain, not nothing: it still happened.
    const openOf = p => p.tasks.filter(t => !CLOSED.has(t.status)).length
    const maxTasks = Math.max(...live.map(p => p.tasks.length))
    const maxOpen = Math.max(1, ...live.map(openOf))
    const maxHeat = Math.max(1, ...live.map(p => p.heat))
    const base = Math.min(W, H) * (live.length === 1 ? 0.2 : 0.13)
    const items = [...live]
      .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
      .map(p => {
        const open = openOf(p)
        return {
          ...p,
          open,
          peak: 0.12 + 0.88 * (open / maxOpen),
          sigma: base * (0.45 + 0.55 * Math.sqrt(p.tasks.length / maxTasks)),
          warmth: p.heat / maxHeat,
        }
      })
    const peaks = placeMountains(items, W, H)

    // A mountain is a range, not a spire: a main summit stretched along a heading
    // and three lower shoulders off it, all seeded from the project's id so the
    // same project keeps the same silhouette. The main summit carries the measure
    // (its height the open tasks, its spread every task); the shoulders follow it.
    const parts = peaks.flatMap((p, k) => {
      const seed = idSeed(p.id)
      const heading = seed * Math.PI * 2
      const main = { k, x: p.x, y: p.y, h: p.peak, sa: p.sigma * 1.35, sb: p.sigma * 0.8, heading }
      const shoulders = [0, 1, 2].map(i => {
        const a = heading + (i - 1) * 2.1 + (hash(seed * 50, i) - 0.5) * 0.8
        const d = p.sigma * (0.7 + 0.35 * hash(i, seed * 90))
        return {
          k,
          x: p.x + Math.cos(a) * d,
          y: p.y + Math.sin(a) * d,
          h: p.peak * (0.45 + 0.3 * hash(seed * 13, i * 7)),
          sa: p.sigma * 0.75,
          sb: p.sigma * 0.5,
          heading: a,
        }
      })
      return [main, ...shoulders]
    })

    const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1
    const field = new Float32Array(cols * rows)
    const owner = new Int16Array(cols * rows)
    const share = new Float32Array(peaks.length)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL, y = j * CELL
        share.fill(0)
        let sum = 0
        for (const c of parts) {
          const dx = x - c.x, dy = y - c.y
          const cos = Math.cos(c.heading), sin = Math.sin(c.heading)
          const u = (dx * cos + dy * sin) / c.sa, v = (-dx * sin + dy * cos) / c.sb
          // Between a cone and a bell: shoulders, not a needle.
          const h = c.h * Math.exp(-((u * u + v * v) ** 0.85) * 0.9)
          sum += h
          share[c.k] += h
        }
        let best = -1, bestV = 0
        for (let k = 0; k < share.length; k++) if (share[k] > bestV) { bestV = share[k]; best = k }
        // Rock: ridged noise cut into the slopes, strongest mid-mountain and absent
        // on the plain, so the ground stays flat and the mountains go craggy.
        const rock = ridged(x / 46, y / 46) * 0.6 + ridged(x / 19 + 7, y / 19 - 3) * 0.3 + ridged(x / 8 - 2, y / 8 + 5) * 0.1
        field[j * cols + i] = sum * (0.84 + 0.3 * rock) + (sum > 0.04 ? 0.03 * rock : 0)
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
        aria-label={map.peaks.map(p => `${p.name}: ${p.open} open of ${p.tasks.length} tasks, ${p.heat} recent updates`).join('; ')}
        onClick={e => { if (e.target === e.currentTarget) setFocus(null) }}
        className="kt-glitch-map"
        style={{ display: 'block' }}
      >
        {view === 'plan'
          ? <PlanView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} W={W} H={H} />
          : <ReliefView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} W={W} H={H} />}
        <Frame W={W} H={H} peaks={map.peaks} levels={map.levels} view={view} />
      </svg>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6, color: 'var(--kt-muted)', fontSize: 10, textTransform: 'uppercase' }}>
        {[['in_progress', 'in progress · summit'], ['todo', 'todo'], ['failed', 'failed'], ['done', 'done · foot']].map(([k, label]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width="8" height="8" aria-hidden="true"><rect x={4 - DOT[k].size / 2} y={4 - DOT[k].size / 2} width={DOT[k].size} height={DOT[k].size} fill={DOT[k].fill} stroke={DOT[k].stroke} strokeWidth={0.7} /></svg>
            {label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="8" height="8" aria-hidden="true"><rect x="2.5" y="2.5" width="3" height="3" fill="none" stroke={LATE} strokeWidth={0.7} /></svg>
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
                {focus.open} open of {focus.tasks.length} tasks · {focus.heat} updates in 30 days
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
