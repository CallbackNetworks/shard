import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isOverdue } from '../../utils/overdue'

const LEVELS = 20            // contour lines between sea level and the highest summit
const INDEX_EVERY = 4        // every fourth line is an index contour, drawn heavier
const CELL = 5               // field resolution: fine enough that small hills draw round, not as diamonds
const TILE = 300             // the endless terrain is computed and cached in tiles this many units square
const MAX_TILES = 64         // a view never asks for more tiles than this at once
const TASK_SPACING = 30      // ground distance between neighbouring task marks
const WORLD_MAX = 2.4        // the ground grows with the work up to this many frames across
// A mountain's spread for a number of tasks: wide enough that its tasks, laid out
// TASK_SPACING apart, fit inside its slopes, plus a floor so one task is still a hill.
export const footprint = n => 26 + TASK_SPACING * 0.6 * Math.sqrt(n)
const HOT = 1, COLD = 0.4 // line opacity at the hottest and the quietest mountain
const FOOTHILL = 0.55        // line opacity on ground that belongs to no project, below any COLD line once dimmed
const TONE_STEPS = 24        // brightness steps between black and white: fine enough to read as a gradient

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

// The ground has axes, so where a mountain stands is a reading, not decoration:
//   left → right  last activity, from RECENCY_DAYS ago (or longer) to today;
//   back → front  progress, from nothing done to everything done.
// "Front right" is recently active and nearly finished; "back left" is untouched.
export const RECENCY_DAYS = 90
export function axes(W, H) {
  // Inset by a mountain's reach, so a summit on the edge keeps its slopes on screen.
  const x0 = W * 0.15, x1 = W * 0.87, y0 = H * 0.2, y1 = H * 0.86
  return {
    x0, x1, y0, y1,
    // `null` means no activity inside the window: the far left edge.
    x: days => x0 + (1 - Math.min(days ?? RECENCY_DAYS, RECENCY_DAYS) / RECENCY_DAYS) * (x1 - x0),
    y: progress => y0 + progress * (y1 - y0),
  }
}

// Each mountain starts at its reading and is nudged only as far as it takes for
// neighbours not to merge into one blob; the label carries the exact values, so
// a few pixels of nudge never misstate them. Deterministic, so nothing moves
// between refreshes.
export function placeMountains(items, W, H) {
  const ax = axes(W, H)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const spots = items.map((m, i) => ({
    ...m,
    // Two projects with identical readings would push along a zero vector; a
    // sub-pixel offset per index picks a direction for them.
    x: ax.x(m.lastActive) + Math.cos(i * golden) * 0.5,
    y: ax.y(m.progress) + Math.sin(i * golden) * 0.5,
  }))
  const clamp = s => {
    s.x = Math.max(ax.x0, Math.min(ax.x1, s.x))
    s.y = Math.max(ax.y0, Math.min(ax.y1, s.y))
  }
  for (let pass = 0; pass < 120; pass++) {
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const A = spots[a], B = spots[b]
        const dx = B.x - A.x, dy = B.y - A.y
        const d = Math.hypot(dx, dy) || 0.01
        const min = (A.sigma + B.sigma) * 1.2
        if (d < min) {
          const push = (min - d) / 2
          A.x -= (dx / d) * push; A.y -= (dy / d) * push
          B.x += (dx / d) * push; B.y += (dy / d) * push
        }
      }
    }
    spots.forEach(clamp)
  }
  return spots
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
// Ground with no project on it, made to look like country rather than filler:
// the coordinates are warped by one noise before another is read, so outlines
// meander; ridged layers at two scales put spurs and gullies in it; and the
// result is sharpened so valleys are broad and crests narrow. 0..~1.
function wilds(x, y) {
  const wx = x + (smooth(x / 95 + 11, y / 95 - 7) - 0.5) * 90
  const wy = y + (smooth(x / 95 - 4, y / 95 + 13) - 0.5) * 90
  const v = 0.42 * smooth(wx / 120, wy / 120)
    + 0.3 * ridged(wx / 62 + 2, wy / 62 - 1)
    + 0.18 * ridged(wx / 29 - 6, wy / 29 + 3)
    + 0.1 * smooth(wx / 13 + 9, wy / 13 - 9)
  return v ** 1.35
}

// In-place 3×3 box blur of a cols×rows grid.
function blur(f, cols, rows) {
  const src = Float32Array.from(f)
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      let acc = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) acc += src[(j + dj) * cols + i + di]
      f[j * cols + i] = acc / 9
    }
  }
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
  // Gaps are rare: the wear is in the opacity, and a line should still read as one.
  const drop = speck < 0.015
  const slip = hash(x + level * 7, y) < 0.03 ? (hash(y, x) - 0.5) * 2.4 : 0
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

// How alive a task is, 0..1: how often it changed in the last 30 days, or how
// recently it changed at all, whichever says more. Feeds a mark's brightness and
// how it breathes, so the parts of the map being worked on are the ones that move.
export function liveliness(task, now = Date.now()) {
  const often = Math.min(1, (task.recent_updates || 0) / 6)
  const age = task.updated_at ? (now - new Date(task.updated_at).getTime()) / 86400000 : Infinity
  const lately = Number.isFinite(age) ? Math.exp(-Math.max(0, age) / 7) * 0.85 : 0
  return Math.max(often, lately)
}

function TaskDot({ d, x, y, on, pickProps }) {
  const style = DOT[d.status]
  const life = liveliness(d.task)
  const base = 0.35 + 0.65 * life
  // A lively mark breathes deeper and quicker; a still one does not breathe at all.
  // The phase comes from the task id, so neighbours do not pulse in step.
  const id = String(d.task.id)
  const breathing = life > 0.08 ? {
    className: 'kt-breathe',
    style: {
      '--breath-period': `${(6.5 - 3.8 * life).toFixed(2)}s`,
      '--breath-lo': (1 - 0.65 * life).toFixed(2),
      animationDelay: `-${(hash(id.length + id.charCodeAt(id.length - 1), id.charCodeAt(0) || 1) * 6).toFixed(2)}s`,
    },
  } : {}
  return (
    <g style={{ cursor: 'pointer' }} {...pickProps}>
      <g {...breathing}>
        {/* Late is the outline turning red, not a recoloured fill: a late todo must not read as failed. */}
        <rect
          x={x - (on ? 3 : style.size / 2)} y={y - (on ? 3 : style.size / 2)}
          width={on ? 6 : style.size} height={on ? 6 : style.size}
          fill={style.fill}
          fillOpacity={on ? 1 : base}
          stroke={isOverdue(d.task) ? LATE : style.stroke}
          strokeOpacity={on ? 1 : Math.max(base, 0.6)}
          strokeWidth={0.7}
        />
      </g>
      {/* The mark is small; the target under the pointer is not. */}
      <circle cx={x} cy={y} r={8} fill="transparent">
        <title>{d.task.title}</title>
      </circle>
    </g>
  )
}

const relativeDays = iso => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'today' : `${d}d ago`
}

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

// A summit: a crosshair on the peak, a leader line, and a two-line monospaced
// readout — name, then open/total · progress · last activity.
function PeakLabel({ p, x, y, W, lineOpacity, pickProps }) {
  const bright = 0.4 + 0.6 * p.warmth
  const name = (p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name).toUpperCase()
  const last = p.lastActive == null ? `IDLE ${RECENCY_DAYS}D+` : p.lastActive === 0 ? 'ACTIVE TODAY' : `LAST ${p.lastActive}D`
  const data = `${String(p.open).padStart(2, '0')}/${String(p.tasks.length).padStart(2, '0')} OPEN · ${String(Math.round(p.progress * 100)).padStart(2, '0')}% DONE · ${last}`
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

// The ground graticule: faint crosses at every grid intersection, and the two
// axes numbered along the front and left edges — days since last activity and
// percent done — drawn through `f` so the relief can lay them on its tilted
// ground plane and its terraces can cover them.
function Graticule({ f, W, H, part = 'all' }) {
  const ax = axes(W, H)
  const days = [90, 75, 60, 45, 30, 15, 0]
  const pcts = [0, 0.25, 0.5, 0.75, 1]
  const xs = days.map(d => ax.x(d)), ys = pcts.map(p => ax.y(p))
  const cross = (x, y) => {
    const [cx, cy] = f(x, y)
    return `M${cx - 2.5},${cy}L${cx + 2.5},${cy}M${cx},${cy - 2.5}L${cx},${cy + 2.5}`
  }
  const tick = (a, b) => { const [x1, y1] = f(...a), [x2, y2] = f(...b); return `M${x1},${y1}L${x2},${y2}` }
  const [fx0, fy0] = f(ax.x0, ax.y1), [fx1, fy1] = f(ax.x1, ax.y1), [bx0, by0] = f(ax.x0, ax.y0)
  const [lx, ly] = f(ax.x1, ax.y1), [px0, py0] = f(ax.x0, ax.y0)
  return (
    <g fontFamily={MONO} fontSize={7.5} fill="rgba(var(--kt-ink-rgb), 0.35)" pointerEvents="none">
      {part !== 'axes' && <path d={xs.flatMap(x => ys.map(y => cross(x, y))).join('')} stroke="rgba(var(--kt-ink-rgb), 0.16)" strokeWidth={0.6} />}
      {part !== 'ground' && <>
      <path d={`M${bx0},${by0}L${fx0},${fy0}L${fx1},${fy1}`} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.18)" strokeWidth={0.6} />
      <path d={xs.map(x => tick([x, ax.y1], [x, ax.y1 - 8])).join('') + ys.map(y => tick([ax.x0, y], [ax.x0 + 8, y])).join('')} stroke="rgba(var(--kt-ink-rgb), 0.3)" strokeWidth={0.6} />
      {xs.map((x, i) => { const [tx, ty] = f(x, ax.y1); return <text key={`x${i}`} x={tx} y={ty + 11} textAnchor="middle">{days[i] === 0 ? 'NOW' : `${days[i]}D`}</text> })}
      {ys.map((y, i) => { const [tx, ty] = f(ax.x0, y); return <text key={`y${i}`} x={tx - 5} y={ty + 2.5} textAnchor="end">{`${Math.round(pcts[i] * 100)}%`}</text> })}
      <text x={lx} y={ly + 22} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.5)">LAST ACTIVITY →</text>
      <text x={px0 - 5} y={py0 - 9} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.5)">DONE ↓</text>
      </>}
    </g>
  )
}

// Corner brackets and a readout, in screen space: the frame of the instrument,
// not part of the ground.
function Frame({ W, H, peaks, view }) {
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
        {`${view === 'plan' ? 'PLAN · DRAG MOVE · WHEEL ZOOM' : 'RELIEF · DRAG MOVE · WHEEL ZOOM · SHIFT TURN'} · SITES ${String(peaks.length).padStart(2, '0')} · TSK ${String(tasks).padStart(3, '0')} · ACT/30D ${String(act).padStart(4, '0')} · LVL ${LEVELS}`}
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
  return h < 0.035 ? x + (hash(band, 3.3) - 0.5) * 10 : x
}

// Each stroke is drawn three times: the line, and a faint ghost a pixel and a half
// either side — misregistration, in the line's own colour. Not red and cyan: on
// this page red means failed and late (ADR-0088), and a fringe must not say so.
const FRINGE = [
  { dx: -1.6, color: 'var(--kt-ink, #f5f6f7)', share: 0.3, cls: 'kt-fringe-r' },
  { dx: 1.6, color: 'var(--kt-ink, #f5f6f7)', share: 0.22, cls: 'kt-fringe-c' },
]


// Top-down: the contour lines themselves.
// Summits seen from the side line up along the horizon, so their names can land on
// top of each other. Nearer labels keep their place; a farther one steps up clear.
function spreadLabels(labels) {
  const placed = []
  for (const l of [...labels].sort((a, b) => b.y - a.y)) {
    let y = l.y
    for (const q of placed) if (Math.abs(q.x - l.x) < 240 && Math.abs(q.y - y) < 32) y = q.y - 32
    placed.push({ ...l, y })
  }
  return placed
}

// The camera: `az` turns the ground about its centre, `tilt` is how steeply it is
// looked down on (1 top-down, 0 edge-on). Dragging moves both, within limits that
// keep the ground readable; a double-click returns here.
// The camera starts nearly overhead, so the terrain fills the frame instead of
// sharing it with a sky; perspective stays, gently, so it still reads as ground.
// `zoom` scales the view and `pan` is the ground point it looks at, relative to
// the middle of the axes.
export const HOME_CAMERA = { az: 0, tilt: 0.9, zoom: 1, pan: [0, 0] }
// The plan is the same ground looked straight down on, without perspective.
export const HOME_PLAN = { az: 0, tilt: 1, zoom: 1, pan: [0, 0], ortho: true }
export const TILT_RANGE = [0.45, 0.98]
export const ZOOM_RANGE = [0.6, 5]

// Perspective projection of ground point (x, y) at height z, and its inverse on
// the ground plane, which panning and zooming need to keep the point under the
// pointer under the pointer.
export function camera(W, H, { az, tilt, zoom = 1, pan = [0, 0], ortho = false }, lift, world = { GW: W, GH: H, fit: 1 }) {
  const ax = axes(world.GW, world.GH)
  const cx = (ax.x0 + ax.x1) / 2 + pan[0], cy = (ax.y0 + ax.y1) / 2 + pan[1]
  const cos = Math.cos(az), sin = Math.sin(az)
  // An orthographic camera is a perspective one whose eye is infinitely far away.
  const D = ortho ? Infinity : W * 1.6
  // `fit` shrinks a ground larger than the frame so all of it is in view at zoom 1.
  const scale = 0.9 * zoom * world.fit
  const base = H * 0.55
  const project = (x, y, z) => {
    const dx = x - cx, dy = y - cy
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    const k = ortho ? scale : (D / (D - ry)) * scale
    return [W / 2 + rx * k, base + (ry * tilt - z * lift) * k]
  }
  const toGround = (sx, sy) => {
    const v = sy - base
    const ry = ortho ? v / (tilt * scale) : (v * D) / (tilt * D * scale + v)
    const k = ortho ? scale : (D / (D - ry)) * scale
    const rx = (sx - W / 2) / k
    return [cx + rx * cos + ry * sin, cy - rx * sin + ry * cos]
  }
  // Nearness: larger is nearer the viewer; 0 is the point looked at.
  const depth = (x, y) => (x - cx) * sin + (y - cy) * cos
  // Where the ground meets the sky — above the frame at the home tilt.
  const horizon = base - D * scale * tilt
  return { project, toGround, depth, horizon, D, centre: [cx, cy] }
}

// The 3D view: the contour terrain in perspective, on a plain that runs to the
// horizon. Drawn on a canvas inside the SVG — tens of thousands of contour
// segments are one stroke call per group there, where as SVG they were elements
// to diff and repaint on every frame of a drag — with the task marks, labels and
// axes as SVG on top, where they stay pointable.
const RISE = 0.3          // the tallest summit stands this fraction of the frame high

function ReliefCanvas({ map, cam, camKey, W, H, lift, moving, tile }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext?.('2d')
    if (!ctx) return
    const scale = 2
    if (canvas.width !== W * scale) { canvas.width = W * scale; canvas.height = H * scale }
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const css = getComputedStyle(canvas)
    const ink = css.getPropertyValue('--kt-ink').trim() || '#f5f6f7'
    const bg = css.getPropertyValue('--kt-bg').trim() || '#0b0c0e'
    const [cx, cy] = cam.centre

    // Light from the far distance: a glow on the horizon, when there is one near
    // the frame — never for the plan, whose eye is infinitely far and has none.
    if (Number.isFinite(cam.horizon) && cam.horizon > -W * 0.75) {
      const glow = ctx.createRadialGradient(W / 2, cam.horizon, 0, W / 2, cam.horizon, W * 0.75)
      glow.addColorStop(0, ink); glow.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.09
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      // The horizon itself is a soft band of that light, not a ruled line.
      const band = ctx.createLinearGradient(0, cam.horizon - 14, 0, cam.horizon + 14)
      band.addColorStop(0, 'transparent'); band.addColorStop(0.5, ink); band.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.08
      ctx.fillStyle = band
      ctx.fillRect(0, cam.horizon - 14, W, 28)
    }

    // The terrain, from whichever tiles the view can see: the ground under the four
    // corners of the frame, widened by a tile. Far away under a low camera that can
    // be a lot of ground, so the count is capped, nearest the centre first.
    // Above the horizon there is no ground to find, so the frame's top corners are
    // read just below it instead.
    const floorY = Number.isFinite(cam.horizon) ? cam.horizon + 30 : -Infinity
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([sx, sy]) => cam.toGround(sx, Math.max(sy, floorY)))
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1])
    const tx0 = Math.floor(Math.min(...xs) / TILE) - 1, tx1 = Math.floor(Math.max(...xs) / TILE) + 1
    const ty0 = Math.floor(Math.min(...ys) / TILE) - 1, ty1 = Math.floor(Math.max(...ys) / TILE) + 1
    const want = []
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty])
    const mid = [cx / TILE, cy / TILE]
    want.sort((a, b) => Math.hypot(a[0] + 0.5 - mid[0], a[1] + 0.5 - mid[1]) - Math.hypot(b[0] + 0.5 - mid[0], b[1] + 0.5 - mid[1]))
    const tiles = want.slice(0, MAX_TILES).map(([tx, ty]) => tile(tx, ty))

    // Terrace by terrace from sea level up, across every tile at once: each closed
    // ring filled with the background so a higher one hides what is behind it,
    // then its contours.
    for (let li = 0; li < LEVELS; li++) {
      const index = (li + 1) % INDEX_EVERY === 0
      if (moving && !index) continue
      const z = ((li + 1) / (LEVELS + 1)) * map.top * lift
      if (lift > 0) {
        ctx.globalAlpha = 0.9
        ctx.fillStyle = bg
        ctx.beginPath()
        for (const t of tiles) {
          for (const ring of t[li].rings) {
            ring.forEach((q, i) => { const [x, y] = cam.project(q[0], q[1], z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
            ctx.closePath()
          }
        }
        ctx.fill()
      }
      for (const t of tiles) {
        for (const st of t[li].strokes) {
          const width = (index ? 0.55 : 0.3) * st.weight
          const alpha = Math.min(1, st.opacity * (index ? 0.8 : 0.55))
          const trace = dx => {
            ctx.beginPath()
            for (const [ax, ay, bx, by] of st.segs) {
              const [x1, y1] = cam.project(ax, ay, z), [x2, y2] = cam.project(bx, by, z)
              ctx.moveTo(tear(x1, y1) + dx, y1); ctx.lineTo(tear(x2, y2) + dx, y2)
            }
            ctx.stroke()
          }
          ctx.strokeStyle = ink
          ctx.lineWidth = width
          if (!moving) {
            for (const fr of FRINGE) { ctx.globalAlpha = alpha * fr.share; trace(fr.dx) }
          }
          ctx.globalAlpha = alpha
          trace(0)
        }
      }
    }
    ctx.globalAlpha = 1
    // Redrawn when the terrain or the camera changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, camKey, W, H, lift, moving, tile])
  return <canvas ref={ref} className="kt-terrain-breathe" style={{ width: W, height: H, display: 'block' }} />
}

function ReliefView({ map, focus, pick, lineOpacity, W, H, view3d, moving, tile }) {
  const { surface, top, peaks, dots } = map
  // Heights scale with the ground, so a larger world is not a flatter one. The plan
  // looks straight down and lifts nothing.
  const lift = view3d.ortho ? 0 : (map.world.GH * RISE) / top
  const cam = camera(W, H, view3d, 1, map.world)
  const px = (x, y, z) => cam.project(x, y, z * lift)
  const step = top / (LEVELS + 1)
  // Marks stand on the surface, nearest drawn last.
  const pins = dots.map(d => ({ d, z: surface(d.x, d.y)[0] })).sort((a, b) => cam.depth(a.d.x, a.d.y) - cam.depth(b.d.x, b.d.y))

  return (
    <>
      <foreignObject x={0} y={0} width={W} height={H} pointerEvents="none">
        <ReliefCanvas map={map} cam={cam} camKey={JSON.stringify(view3d)} W={W} H={H} lift={lift} moving={moving} tile={tile} />
      </foreignObject>
      <Graticule f={(x, y) => px(x, y, 0)} W={map.world.GW} H={map.world.GH} part="axes" />
      {pins.map(({ d, z }) => {
        const [x, y] = px(d.x, d.y, z)
        const on = focus?.kind === 'task' && focus.task.id === d.task.id
        return <TaskDot key={d.task.id} d={d} x={x} y={y - 1.5} on={on} pickProps={pick('task', d)} />
      })}
      {spreadLabels(peaks.map(p => {
        // On the highest contour at or below the summit.
        const z = Math.floor(surface(p.x, p.y)[0] / step) * step
        const [x, y] = px(p.x, p.y, z)
        return { p, x, y }
      })).map(({ p, x, y }) => <PeakLabel key={p.id} p={p} x={x} y={y} W={W} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
    </>
  )
}

// One square of the endless terrain, from the map's surface function: the field
// sampled on the global CELL lattice with a two-cell pad, blurred (the pad makes
// the blur exact at the edges, so neighbouring tiles share their border values and
// contours run across the seam unbroken), then traced at the map's fixed contour
// heights. Rings that close inside the tile are kept for the relief's fills.
export function buildTile(map, tx, ty) {
  const n = TILE / CELL, P = 2, size = n + 1 + 2 * P
  const x0 = tx * TILE, y0 = ty * TILE
  const raw = new Float32Array(size * size), warmA = new Float32Array(size * size), ownA = new Float32Array(size * size)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [h, w, o] = map.surface(x0 + (i - P) * CELL, y0 + (j - P) * CELL)
      raw[j * size + i] = h; warmA[j * size + i] = w; ownA[j * size + i] = o
    }
  }
  // Two passes of a 3×3 box blur: the ridged layers fold the surface along their
  // crests, and contours traced across a fold turn corners no terrain draws.
  blur(raw, size, size)
  blur(raw, size, size)
  const m = n + 1
  const inner = (arr) => {
    const out = new Float32Array(m * m)
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) out[j * m + i] = arr[(j + P) * size + i + P]
    return out
  }
  const field = inner(raw), warm = inner(warmA), owned = inner(ownA)
  const sample = (arr, gx, gy) => {
    const i0 = Math.max(0, Math.min(m - 2, Math.floor(gx))), j0 = Math.max(0, Math.min(m - 2, Math.floor(gy)))
    const fx = Math.max(0, Math.min(1, gx - i0)), fy = Math.max(0, Math.min(1, gy - j0))
    const a = arr[j0 * m + i0], b = arr[j0 * m + i0 + 1], c = arr[(j0 + 1) * m + i0], d = arr[(j0 + 1) * m + i0 + 1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
  const gx0 = x0 / CELL, gy0 = y0 / CELL
  const W = (gx) => x0 + gx * CELL, Hy = (gy) => y0 + gy * CELL
  const levels = []
  for (let l = 1; l <= LEVELS; l++) {
    const z = (l / (LEVELS + 1)) * map.top
    const segs = contours(field, m, m, z)
    const strokes = new Map()
    for (const [a, b] of segs) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      // Grain is read on the global lattice, so the wear does not restart at a seam.
      const g = grain(gx0 + mx, gy0 + my, l)
      if (g.drop) continue
      const w = sample(warm, mx, my), mine = sample(owned, mx, my)
      const alpha = (g.bucket + 0.5) / GRAIN_BUCKETS
      const opacity = (FOOTHILL + ((COLD + (HOT - COLD) * w) - FOOTHILL) * mine) * (0.8 + 0.2 * alpha)
      const weight = 1 + ((0.7 + 0.7 * w) - 1) * mine
      const qo = Math.round(opacity * TONE_STEPS), qw = Math.round(weight * 4)
      const key = `${qo}:${qw}`
      if (!strokes.has(key)) strokes.set(key, { opacity: qo / TONE_STEPS, weight: qw / 4, segs: [] })
      strokes.get(key).segs.push([W(a[0] + g.slip), Hy(a[1]), W(b[0] + g.slip), Hy(b[1])])
    }
    const rings = stitch(segs)
      .filter(r => Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1e-6)
      .map(r => r.map(([gx, gy]) => [W(gx), Hy(gy)]))
    levels.push({ l, z, index: l % INDEX_EVERY === 0, rings, strokes: [...strokes.values()] })
  }
  return levels
}

// Everything the terrain is computed from, as one string: equal strings mean the
// same map, so a refetch that changed nothing recomputes nothing.
export const terrainKey = projects => projects.map(p => [
  p.id, p.name, p.heat, p.lastActive,
  p.tasks.map(t => `${t.id}:${t.status}:${t.due_date || ''}:${t.updated_at || ''}:${t.recent_updates || 0}`).join(','),
].join('|')).join(';')

// Past a handful the map stops being a landscape and becomes texture, so the
// mountains with the most open work are drawn and the rest fold into one low
// range that says how many it holds. Their tasks stay on the map, in it.
export const MAX_MOUNTAINS = 8
export function foldFoothills(projects) {
  if (projects.length <= MAX_MOUNTAINS) return projects
  const openOf = p => p.tasks.filter(t => !CLOSED.has(t.status)).length
  const ranked = [...projects].sort((a, b) => openOf(b) - openOf(a) || b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
  const kept = ranked.slice(0, MAX_MOUNTAINS - 1)
  const rest = ranked.slice(MAX_MOUNTAINS - 1)
  const recent = rest.map(p => p.lastActive).filter(d => d != null)
  return [...kept, {
    id: 'foothills',
    name: `+${rest.length} other projects`,
    tasks: rest.flatMap(p => p.tasks),
    heat: rest.reduce((n, p) => n + p.heat, 0),
    lastActive: recent.length ? Math.min(...recent) : null,
    members: rest.map(p => p.name),
  }]
}

/**
 * The share as one landscape: every project is a mountain whose size is its task
 * count, and whose contour lines are as bright as the project is busy. Tasks sit on
 * its slopes — in progress near the summit, done at the foot — and can be inspected.
 *
 * `projects`: `[{ id, name, tasks: [{ id, title, status, due_date, progress_pct }], heat, lastActive }]`
 * where `heat` is a recent activity count and `lastActive` the days since the
 * project last changed (`null` when not within RECENCY_DAYS).
 */
export default function ContourMap({ projects, width = 720, height = 420, emptyLabel = 'Nothing to map yet', initialView = 'relief', extraViews = [] }) {
  const [focus, setFocus] = useState(null) // { kind: 'task' | 'peak', ... }
  const [view, setView] = useState(initialView) // 'relief' (3D) | 'plan' (top-down) | an extra view's key
  // One camera per view, so switching between them keeps where each was looking.
  const [cams, setCams] = useState({ relief: HOME_CAMERA, plan: HOME_PLAN })
  const view3d = cams[view] || HOME_CAMERA
  const setView3d = next => setCams(c => ({ ...c, [view]: typeof next === 'function' ? next(c[view]) : next }))
  const [drag, setDrag] = useState(null) // the gesture in progress, if any
  const frame = useRef(0)
  const pointers = useRef(new Map())
  const svgRef = useRef(null)

  // Pointer positions in the SVG's own units, which is what the camera works in.
  const local = e => {
    const r = svgRef.current.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height]
  }
  const clampZoom = z => Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], z))
  // Move `cam` so the ground point that was under `before` (screen) ends up under
  // `after`: the rule for both dragging and zooming about the pointer.
  const keepUnder = (from, next, before, after) => {
    const g0 = camera(width, height, from, 1, map.world).toGround(...before)
    const g1 = camera(width, height, next, 1, map.world).toGround(...after)
    return { ...next, pan: [next.pan[0] + g0[0] - g1[0], next.pan[1] + g0[1] - g1[1]] }
  }
  const schedule = next => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setView3d(next))
  }

  // Drag moves the ground under the pointer; shift-drag (or a right-button drag)
  // turns and tilts it; two fingers pinch to zoom and move together to pan. One
  // finger moving vertically is left to the page, so the map never traps a scroll.
  const orbit = {
    onPointerDown: e => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      pointers.current.set(e.pointerId, local(e))
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const pts = [...pointers.current.values()]
      if (pts.length === 2) {
        setDrag({ mode: 'pinch', d0: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), mid: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], from: view3d })
      } else {
        // The plan has no heading or tilt to change: every drag on it pans.
        setDrag({ mode: (e.shiftKey || e.button === 2) && view === 'relief' ? 'orbit' : 'pan', at: local(e), from: view3d })
      }
    },
    onPointerMove: e => {
      if (!drag || !pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, local(e))
      const pts = [...pointers.current.values()]
      if (drag.mode === 'pinch' && pts.length === 2) {
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
        const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
        schedule(keepUnder(drag.from, { ...drag.from, zoom: clampZoom(drag.from.zoom * (d / (drag.d0 || 1))) }, drag.mid, mid))
      } else if (drag.mode === 'orbit') {
        const [x, y] = local(e)
        schedule({
          ...drag.from,
          az: drag.from.az + (x - drag.at[0]) * 0.008,
          tilt: Math.max(TILT_RANGE[0], Math.min(TILT_RANGE[1], drag.from.tilt - (y - drag.at[1]) * 0.004)),
        })
      } else if (drag.mode === 'pan') {
        schedule(keepUnder(drag.from, drag.from, drag.at, local(e)))
      }
    },
    onPointerUp: e => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) setDrag(null)
    },
    onPointerCancel: e => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) setDrag(null)
    },
    onContextMenu: e => e.preventDefault(),
    onDoubleClick: () => setView3d(view === 'plan' ? HOME_PLAN : HOME_CAMERA),
  }

  // The wheel zooms about the pointer. Attached by hand: React's wheel listener is
  // passive, and without preventDefault the page would scroll as well.
  useEffect(() => {
    const el = svgRef.current
    if (!el || (view !== 'relief' && view !== 'plan')) return
    const onWheel = e => {
      e.preventDefault()
      const at = local(e)
      setView3d(v => keepUnder(v, { ...v, zoom: clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0008)) }, at, at))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  const W = width, H = height

  const map = useMemo(() => {
    const withTasks = projects.filter(p => p.tasks.length > 0)
    if (withTasks.length === 0) return null
    const live = foldFoothills(withTasks)
    // Two measures, so two projects of one size can still look different:
    //   width  = every task the project holds — its footprint, the whole of the work;
    //   height = the tasks still open — how much climbing is left.
    // A big project that is mostly done is broad and low; a new one is narrow and
    // steep. A finished project is a low plain, not nothing: it still happened.
    const openOf = p => p.tasks.filter(t => !CLOSED.has(t.status)).length
    const maxOpen = Math.max(1, ...live.map(openOf))
    const maxHeat = Math.max(1, ...live.map(p => p.heat))
    const items = [...live]
      .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
      .map(p => {
        const open = openOf(p)
        const done = p.tasks.filter(t => t.status === 'done').length
        return {
          ...p,
          open,
          progress: done / p.tasks.length,
          // The folded range stays low whatever it holds: it is the rest, not a summit.
          peak: p.id === 'foothills' ? Math.min(0.3, 0.12 + 0.88 * (open / maxOpen)) : 0.12 + 0.88 * (open / maxOpen),
          // Absolute, not relative to the largest: every task is given the same patch
          // of ground, so a project's footprint grows with its work and its tasks
          // never crowd however many there are.
          sigma: footprint(p.tasks.length),
          warmth: p.heat / maxHeat,
        }
      })
    // The ground is as large as the work on it: the frame's area, grown until the
    // mountains' footprints fit with room between them. The 3D view starts zoomed
    // out by the same factor, so everything is in sight before anyone zooms in.
    const need = items.reduce((n, p) => n + Math.PI * (p.sigma * 1.5) ** 2, 0)
    const S = Math.max(1, Math.min(WORLD_MAX, Math.sqrt(need / (0.42 * W * H))))
    const GW = W * S, GH = H * S
    const peaks = placeMountains(items, GW, GH)

    // One range, not separate mountains. The summits are strung along a spine in
    // the order of the horizontal axis — so the range runs from long-idle work to
    // recent work — and each pair of neighbours is joined by a ridge that dips to a
    // saddle between them. Each summit is stretched along the spine where it
    // stands, so its shape comes from the range rather than from chance.
    const chain = peaks.map((p, k) => ({ ...p, k })).sort((a, b) => a.x - b.x || a.y - b.y)
    const heading = chain.map((p, n) => {
      const prev = chain[n - 1] || p, next = chain[n + 1] || p
      return prev === next ? 0 : Math.atan2(next.y - prev.y, next.x - prev.x)
    })
    const summits = chain.map((p, n) => ({ k: p.k, x: p.x, y: p.y, h: p.peak, sa: p.sigma * 1.3, sb: p.sigma * 0.85, heading: heading[n] }))
    const ridges = chain.slice(1).map((B, n) => ({ A: chain[n], B }))
    const highest = Math.max(...peaks.map(p => p.peak))

    // The terrain is a function of position, defined everywhere: the projects'
    // summits and ridges where they stand, and foothills and valleys without end
    // around them. Nothing is computed here but its shape; the views ask for the
    // tiles they can see (buildTile), so the ground goes on as far as anyone pans.
    // Each sample also carries how warm the projects whose ground it is are (their
    // heat, mixed by how much of the height each contributes) and how much of the
    // height is theirs at all rather than foothills, so brightness varies smoothly.
    const heads = summits.map(c => ({ ...c, cos: Math.cos(c.heading), sin: Math.sin(c.heading) }))
    const share = new Float32Array(peaks.length)
    const surface = (x, y) => {
      share.fill(0)
      let sum = 0
      for (const c of heads) {
        const dx = x - c.x, dy = y - c.y
        const u = (dx * c.cos + dy * c.sin) / c.sa, v = (-dx * c.sin + dy * c.cos) / c.sb
        // Between a cone and a bell: shoulders, not a needle.
        const h = c.h * Math.exp(-((u * u + v * v) ** 0.85) * 0.9)
        sum += h
        share[c.k] += h
      }
      for (const { A, B } of ridges) {
        const ex = B.x - A.x, ey = B.y - A.y
        const len2 = ex * ex + ey * ey || 1
        const t = Math.max(0, Math.min(1, ((x - A.x) * ex + (y - A.y) * ey) / len2))
        const d = Math.hypot(x - (A.x + ex * t), y - (A.y + ey * t))
        const w = (A.sigma + (B.sigma - A.sigma) * t) * 0.55
        // Highest at the summits it joins, lowest midway: a saddle.
        const crest = (A.peak + (B.peak - A.peak) * t) * 0.5 * (1 - 0.45 * Math.sin(Math.PI * t))
        const h = crest * Math.exp(-((d / w) ** 2))
        sum += h
        share[A.k] += h * (1 - t)
        share[B.k] += h * t
      }
      // Foothills and valleys, never a flat plain; they belong to no project.
      const hills = highest * 0.36 * wilds(x, y)
      let mix = 0
      for (let k = 0; k < share.length; k++) mix += share[k] * peaks[k].warmth
      const ratio = sum / (sum + hills || 1)
      const t = Math.max(0, Math.min(1, (ratio - 0.3) / 0.45))
      // Rock: ridged noise cut into the slopes.
      const rock = ridged(x / 46, y / 46) * 0.6 + ridged(x / 19 + 7, y / 19 - 3) * 0.3 + ridged(x / 8 - 2, y / 8 + 5) * 0.1
      return [(sum + hills) * (0.84 + 0.3 * rock), sum > 0 ? mix / sum : 0, t * t * (3 - 2 * t)]
    }
    // Contour heights are fixed for the whole map, so tiles agree where they meet:
    // spaced up to the highest point near the mountains.
    let top = 0
    for (let y = -TILE; y <= GH + TILE; y += 8) for (let x = -TILE; x <= GW + TILE; x += 8) top = Math.max(top, surface(x, y)[0])
    top *= 0.97

    // Tasks on the slopes, as a sunflower spiral from the summit outward: each
    // point sits at the same distance from its neighbours whatever the count, in
    // status order — in progress at the top, then todo, failed, and done at the foot.
    const golden = Math.PI * (3 - Math.sqrt(5))
    const rank = { in_progress: 0, todo: 1, failed: 2, done: 3 }
    const dots = peaks.flatMap(p => [...p.tasks]
      .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1))
      .map((t, i) => {
        const r = TASK_SPACING * 0.62 * Math.sqrt(i + 0.8)
        const a = i * golden + p.x * 0.013
        return { task: t, project: p.name, status: t.status in DOT ? t.status : 'todo', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }
      }))
    return { peaks, dots, surface, top, world: { GW, GH, fit: 1 / S } }
    // Keyed on what the map is drawn from, not on the array's identity: the share
    // page refetches every 30 seconds and hands over a fresh array each time, and
    // rebuilding the terrain for unchanged data cost a visitor about a second and a
    // half of script every half minute for as long as the page stayed open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainKey(projects), W, H])

  // Tiles of the endless terrain, built when a view first needs them and kept for
  // as long as the map is the same map.
  // A fresh cache per map: `map` is not read, it is what the cache belongs to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tileCache = useMemo(() => new Map(), [map])
  const tile = useCallback((tx, ty) => {
    const key = `${tx},${ty}`
    if (!tileCache.has(key)) tileCache.set(key, buildTile(map, tx, ty))
    return tileCache.get(key)
  }, [map, tileCache])

  if (!map) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.28)', fontSize: 12, padding: '18px 0' }}>{emptyLabel}</div>
  }

  const overdue = isOverdue
  // Another view of the same projects, offered beside the map rather than in its own panel.
  const extra = extraViews.find(v => v.key === view)

  const pick = (kind, d) => ({ onMouseEnter: () => setFocus({ kind, ...d }), onClick: () => setFocus({ kind, ...d }) })
  const lineOpacity = warmth => COLD + (HOT - COLD) * warmth

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, marginTop: -6, marginBottom: 4 }}>
        {[['relief', '3D'], ['plan', 'Map'], ...extraViews.map(v => [v.key, v.label])].map(([key, label]) => (
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
      {extra ? extra.render() : (
        <>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={map.peaks.map(p => `${p.name}: ${p.open} open of ${p.tasks.length} tasks, ${p.heat} recent updates`).join('; ')}
          onClick={e => { if (e.target === e.currentTarget) setFocus(null) }}
          ref={svgRef}
          className="kt-glitch-map"
          style={{ display: 'block', cursor: drag ? 'grabbing' : 'grab', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}
          {...orbit}
        >
          <ReliefView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} W={W} H={H} view3d={view3d} moving={!!drag} tile={tile} />
          <Frame W={W} H={H} peaks={map.peaks} view={view} />
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
          <span>· brighter and breathing = changed lately</span>
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
                {focus.members && (
                  <div style={{ color: 'var(--kt-muted)' }}>
                    {focus.members.slice(0, 6).join(', ')}{focus.members.length > 6 && ` and ${focus.members.length - 6} more`}
                  </div>
                )}
              </>
            ) : (
              <>
                <b style={{ color: 'var(--kt-ink)' }}>{focus.task.title}</b>
                <div style={{ color: 'var(--kt-muted)' }}>
                  {focus.project} · {focus.status.replace('_', ' ')}
                  {focus.task.progress_pct != null && ` · ${focus.task.progress_pct}%`}
                  {focus.task.due_date && ` · due ${new Date(focus.task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
                {focus.task.updated_at && ` · changed ${relativeDays(focus.task.updated_at)}`}
                {focus.task.recent_updates > 0 && ` · ${focus.task.recent_updates} updates in 30 days`}
                  {overdue(focus.task) && <span style={{ color: 'var(--kt-status-failed, #fb7185)' }}> · overdue</span>}
                </div>
              </>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}
