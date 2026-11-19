import { useMemo, useRef, useState } from 'react'
import { isOverdue } from '../../utils/overdue'

const LEVELS = 28            // contour lines between sea level and the highest summit
const INDEX_EVERY = 5        // every fifth line is an index contour, drawn heavier
const CELL = 8               // field resolution: coarse enough that contours turn corners
const MARGIN = 160           // ground computed past each edge of the frame
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
        {`${view === 'plan' ? 'PLAN' : 'RELIEF · DRAG TO ORBIT'} · SITES ${String(peaks.length).padStart(2, '0')} · TSK ${String(tasks).padStart(3, '0')} · ACT/30D ${String(act).padStart(4, '0')} · LVL ${levels.length}`}
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
  return h < 0.08 ? x + (hash(band, 3.3) - 0.5) * 24 : x
}

const segPath = (segs, f, dx = 0) => segs.map(([ax, ay, bx, by]) => {
  const [x1, y1] = f(ax, ay), [x2, y2] = f(bx, by)
  return `M${(tear(x1, y1) + dx).toFixed(1)},${y1.toFixed(1)}L${(tear(x2, y2) + dx).toFixed(1)},${y2.toFixed(1)}`
}).join('')

// Each stroke is drawn three times: the line, and a faint ghost a pixel and a half
// either side — misregistration, in the line's own colour. Not red and cyan: on
// this page red means failed and late (ADR-0088), and a fringe must not say so.
const FRINGE = [
  { dx: -1.6, color: 'var(--kt-ink, #f5f6f7)', share: 0.3, cls: 'kt-fringe-r' },
  { dx: 1.6, color: 'var(--kt-ink, #f5f6f7)', share: 0.22, cls: 'kt-fringe-c' },
]

function Strokes({ level, f, lineOpacity, peaks, fringe = true }) {
  return level.strokes.map((st, k) => {
    // Heat is carried twice, by brightness and by weight, and the noise only
    // shades the line by a fifth — less than the gap between a busy mountain and
    // a quiet one — so the wear never reads as a change in heat.
    // Ground that belongs to no project (owner -1) is the range's foothills: drawn,
    // so the map reads as one landscape, but at a fixed low weight that no
    // project's heat goes down to.
    const own = peaks[st.owner]
    const warmth = own?.warmth ?? 0
    const width = (level.index ? 0.55 : 0.3) * (own ? 0.7 + 0.7 * warmth : 1)
    const opacity = own
      ? Math.min(1, lineOpacity(warmth) * (0.8 + 0.2 * st.alpha) * (level.index ? 0.8 : 0.55))
      : 0.3 * (0.8 + 0.2 * st.alpha) * (level.index ? 1.4 : 1)
    return (
      <g key={k}>
        {fringe && FRINGE.map(fr => (
          <path key={fr.cls} className={fr.cls} d={segPath(st.segs, f, fr.dx)} fill="none" stroke={fr.color}
            strokeOpacity={opacity * fr.share} strokeWidth={width} strokeLinecap="butt" />
        ))}
        <path d={segPath(st.segs, f)} fill="none" stroke="var(--kt-ink, #f5f6f7)" strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" />
      </g>
    )
  })
}

// Top-down: the contour lines themselves.
function PlanView({ map, focus, pick, lineOpacity, W, H }) {
  const f = (x, y) => [x * CELL - MARGIN, y * CELL - MARGIN]
  return (
    <>
      <Graticule f={(x, y) => [x, y]} W={W} H={H} />
      {map.levels.map(level => <g key={level.l}><Strokes level={level} f={f} lineOpacity={lineOpacity} peaks={map.peaks} /></g>)}
      {map.dots.map(d => (
        <TaskDot key={d.task.id} d={d} x={d.x} y={d.y} on={focus?.kind === 'task' && focus.task.id === d.task.id} pickProps={pick('task', d)} />
      ))}
      {map.peaks.map(p => <PeakLabel key={p.id} p={p} x={p.x} y={p.y} W={W} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
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

const RISE = 0.32       // the tallest summit stands this fraction of the frame high
// The camera: `az` turns the ground about its centre, `tilt` is how steeply it is
// looked down on (1 top-down, 0 edge-on). Dragging moves both, within limits that
// keep the ground readable; a double-click returns here.
export const HOME_CAMERA = { az: 0, tilt: 0.62 }
export const TILT_RANGE = [0.3, 0.72]

// Perspective projection of ground point (x, y) at height z. Distance shrinks
// what is far, so the terrain reads as a solid rather than a stack of drawings.
export function camera(W, H, { az, tilt }, lift) {
  const ax = axes(W, H)
  const cx = (ax.x0 + ax.x1) / 2, cy = (ax.y0 + ax.y1) / 2
  const cos = Math.cos(az), sin = Math.sin(az)
  const D = W * 1.4
  const project = (x, y, z) => {
    const dx = x - cx, dy = y - cy
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    // One zoom for every heading: small enough that the ground's diagonal, which
    // is what spans the frame once it is turned, still fits inside it.
    const k = (D / (D - ry)) * 0.9
    return [W / 2 + rx * k, H * 0.58 + (ry * tilt - z * lift) * k]
  }
  // Nearness, for drawing order: larger is nearer the viewer.
  const depth = (x, y) => (x - cx) * sin + (y - cy) * cos
  return { project, depth }
}

// In relief: every contour ring lifted to its own height, stacked from sea level
// up like terraces. Each ring is filled with the background, so a higher terrace
// hides the part of a lower one that is behind the hill; a task stands on the
// terrace beneath it.
function ReliefView({ map, focus, pick, lineOpacity, W, H, view3d, moving }) {
  const { field, cols, rows, top, peaks, dots, levels } = map
  const lift = (H * RISE) / top
  const cam = camera(W, H, view3d, lift)
  const px = cam.project
  const height = (x, y) => {
    const i = Math.max(0, Math.min(cols - 1, Math.round((x + MARGIN) / CELL)))
    const j = Math.max(0, Math.min(rows - 1, Math.round((y + MARGIN) / CELL)))
    return field[j * cols + i]
  }

  // Pins stand on the surface but are drawn above every terrace, nearest last: a
  // pin's head rises into the terrace above it, and hiding it there would hide a
  // task in front of the hill, not behind it.
  const pins = dots.map(d => ({ d, z: height(d.x, d.y) })).sort((a, b) => cam.depth(a.d.x, a.d.y) - cam.depth(b.d.x, b.d.y))
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
      <Graticule f={(x, y) => px(x, y, 0)} W={W} H={H} part="ground" />
      {levels.map(level => {
        const f = (x, y) => px(x * CELL - MARGIN, y * CELL - MARGIN, level.z)
        const fill = level.rings.map(r => r.map((p, i) => {
          const [x, y] = f(p[0], p[1])
          return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
        }).join('') + 'Z').join('')
        return (
          <g key={level.l}>
            <path d={fill} fill="var(--kt-bg, #0b0c0e)" fillOpacity={0.9} fillRule="nonzero" />
            <Strokes level={level} f={f} lineOpacity={lineOpacity} peaks={peaks} fringe={!moving} />
          </g>
        )
      })}
      {/* The terrain now covers the ground, so the axes are read on top of it. */}
      <Graticule f={(x, y) => px(x, y, 0)} W={W} H={H} part="axes" />
      {pins.map(pin)}
      {spreadLabels(peaks.map(p => {
        // On the highest ring actually drawn near this summit, not on the spike above
        // it that nothing outlines.
        const near = (p.sigma * 0.6) / CELL
        const z = levels.findLast(lv => lv.strokes.some(st => st.segs.some(([ax, ay]) =>
          Math.hypot(ax - (p.x + MARGIN) / CELL, ay - (p.y + MARGIN) / CELL) < near)))?.z ?? 0
        const [x, y] = px(p.x, p.y, z)
        return { p, x, y }
      })).map(({ p, x, y }) => <PeakLabel key={p.id} p={p} x={x} y={y} W={W} lineOpacity={lineOpacity} pickProps={pick('peak', p)} />)}
    </>
  )
}

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
  const [view3d, setView3d] = useState(HOME_CAMERA)
  const [drag, setDrag] = useState(null) // { x, y, from } while the pointer is orbiting
  const frame = useRef(0)

  // Drag to orbit: sideways turns the ground, up and down changes how steeply it
  // is seen. A finger only turns it, so a vertical swipe still scrolls the page.
  const orbit = {
    onPointerDown: e => {
      if (e.button !== 0) return
      setDrag({ x: e.clientX, y: e.clientY, from: view3d, touch: e.pointerType === 'touch' })
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: e => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => setView3d({
        az: drag.from.az + dx * 0.008,
        tilt: drag.touch ? drag.from.tilt : Math.max(TILT_RANGE[0], Math.min(TILT_RANGE[1], drag.from.tilt - dy * 0.004)),
      }))
    },
    onPointerUp: () => setDrag(null),
    onPointerCancel: () => setDrag(null),
    onDoubleClick: () => setView3d(HOME_CAMERA),
  }
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
    const maxTasks = Math.max(...live.map(p => p.tasks.length))
    const maxOpen = Math.max(1, ...live.map(openOf))
    const maxHeat = Math.max(1, ...live.map(p => p.heat))
    // Fewer mountains get more room each; more share the ground.
    const base = Math.min(W, H) * (live.length === 1 ? 0.28 : 0.21 * Math.sqrt(3 / Math.max(3, live.length)))
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
          sigma: base * (0.45 + 0.55 * Math.sqrt(p.tasks.length / maxTasks)),
          warmth: p.heat / maxHeat,
        }
      })
    const peaks = placeMountains(items, W, H)

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

    // The ground runs a margin past the frame on every side, so a mountain near the
    // edge slopes away out of view instead of being cut off at the border.
    const cols = Math.ceil((W + 2 * MARGIN) / CELL) + 1, rows = Math.ceil((H + 2 * MARGIN) / CELL) + 1
    const field = new Float32Array(cols * rows)
    const owner = new Int16Array(cols * rows)
    const share = new Float32Array(peaks.length)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL - MARGIN, y = j * CELL - MARGIN
        share.fill(0)
        let sum = 0
        for (const c of summits) {
          const dx = x - c.x, dy = y - c.y
          const cos = Math.cos(c.heading), sin = Math.sin(c.heading)
          const u = (dx * cos + dy * sin) / c.sa, v = (-dx * sin + dy * cos) / c.sb
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
        // The rest of the ground is foothills and valleys, never a flat plain, so
        // the whole map is terrain. It belongs to no project and is drawn dark.
        // Fading to nothing toward the rim of the computed ground, so the lowest
        // contours close as a coastline rather than along the rim's straight edge.
        const rim = Math.min(x + MARGIN, W + MARGIN - x, y + MARGIN, H + MARGIN - y) / (MARGIN * 0.9)
        const shore = rim >= 1 ? 1 : rim <= 0 ? 0 : rim * rim * (3 - 2 * rim)
        const hills = shore * highest * 0.32 * (0.5 * smooth(x / 110, y / 110) + 0.3 * smooth(x / 55 + 3, y / 55 - 2) + 0.2 * smooth(x / 27 - 5, y / 27 + 4))
        let best = -1, bestV = 0
        for (let k = 0; k < share.length; k++) if (share[k] > bestV) { bestV = share[k]; best = k }
        if (bestV < (sum + hills) * 0.35) best = -1
        // Rock: ridged noise cut into the slopes.
        const rock = ridged(x / 46, y / 46) * 0.6 + ridged(x / 19 + 7, y / 19 - 3) * 0.3 + ridged(x / 8 - 2, y / 8 + 5) * 0.1
        field[j * cols + i] = (sum + hills) * (0.84 + 0.3 * rock)
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
          className="kt-glitch-map"
          style={{ display: 'block', cursor: view === 'relief' ? (drag ? 'grabbing' : 'grab') : undefined, touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}
          {...(view === 'relief' ? orbit : {})}
        >
          {view === 'plan'
            ? <PlanView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} W={W} H={H} />
            : <ReliefView map={map} focus={focus} pick={pick} lineOpacity={lineOpacity} W={W} H={H} view3d={view3d} moving={!!drag} />}
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
