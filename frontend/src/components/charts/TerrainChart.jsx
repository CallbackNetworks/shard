import { useMemo, useState } from 'react'

const ROW = 34          // vertical distance between two ridges' baselines
const AMP = 74          // how tall the busiest week stands: taller than ROW, so ridges overlap
const LEVELS = [1, 0.8, 0.6, 0.4, 0.2]   // the ridge itself, then contours inside it
const WEEK_MS = 7 * 86400000

// Weekly totals per series over the last `weeks` weeks, oldest first, smoothed with
// a small kernel so a single busy day reads as a hill rather than a spike.
export function weeklyTerrain(series, weeks, now = new Date()) {
  const end = now.getTime()
  const rows = series.map(s => {
    const raw = new Array(weeks).fill(0)
    for (const d of s.days) {
      // Noon of today is still ahead in the morning: that is this week, not the future.
      const age = Math.floor(Math.max(0, end - new Date(`${d.date}T12:00:00`).getTime()) / WEEK_MS)
      if (age >= 0 && age < weeks) raw[weeks - 1 - age] += d.count
    }
    const kernel = [0.25, 0.5, 0.25]
    const smooth = raw.map((_, i) => kernel.reduce((sum, k, j) => sum + k * (raw[i + j - 1] ?? raw[i]), 0))
    return { ...s, raw, smooth, total: raw.reduce((a, b) => a + b, 0) }
  })
  const peak = Math.max(1, ...rows.flatMap(r => r.smooth))
  return { rows, peak }
}

function ridgePath(values, peak, baseline, level, xAt) {
  const pts = values.map((v, i) => [xAt(i), baseline - (v / peak) * AMP * level])
  // Catmull-Rom through the weekly points, written out as cubic Béziers.
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    // Clamped to the baseline: a spline through a quiet week dips below sea level otherwise.
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(baseline, p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(baseline, p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

/**
 * Activity as terrain: one ridge per series, stacked back to front so the ridges
 * overlap like a relief map, each with contour lines inside it at fixed fractions
 * of its own height. `series` is `[{ id, name, days: [{ date, count }] }]`.
 */
export default function TerrainChart({ series, weeks = 26, width = 720, emptyLabel = 'No activity yet', weekLabel = 'week of' }) {
  // A narrow canvas spends less of itself on names, so the ridges keep their width.
  const W = width
  const PAD = { t: AMP + 6, r: 12, b: 36, l: width < 500 ? 92 : 132 }
  const [hover, setHover] = useState(null)
  const { rows, peak } = useMemo(() => weeklyTerrain(series, weeks), [series, weeks])

  if (rows.length === 0 || rows.every(r => r.total === 0)) {
    return <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.28)', fontSize: 12, padding: '18px 0' }}>{emptyLabel}</div>
  }

  const H = PAD.t + (rows.length - 1) * ROW + PAD.b
  const innerW = W - PAD.l - PAD.r
  const xAt = i => PAD.l + (weeks === 1 ? innerW / 2 : (i / (weeks - 1)) * innerW)
  const weekStart = i => new Date(Date.now() - (weeks - 1 - i) * WEEK_MS)
  const fmt = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' })

  const onMove = e => {
    const svg = e.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const { x } = pt.matrixTransform(svg.getScreenCTM().inverse())
    const i = Math.round(((x - PAD.l) / innerW) * (weeks - 1))
    setHover(i >= 0 && i < weeks ? i : null)
  }

  // Month ticks: the first week whose start falls in a new month.
  const ticks = []
  for (let i = 0; i < weeks; i++) {
    const m = weekStart(i).getMonth()
    if (i > 0 && m !== weekStart(i - 1).getMonth()) ticks.push(i)
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={rows.map(r => `${r.name}: ${r.total}`).join(', ')}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {ticks.map(i => (
          <g key={i}>
            <line x1={xAt(i)} x2={xAt(i)} y1={8} y2={H - PAD.b} stroke="rgba(var(--kt-ink-rgb), 0.05)" />
            <text x={xAt(i)} y={H - 6} fontSize={10} fill="rgba(var(--kt-ink-rgb), 0.35)" textAnchor="middle">
              {weekStart(i).toLocaleDateString('en', { month: 'short' }).toUpperCase()}
            </text>
          </g>
        ))}

        {/* Back to front: the first series is the farthest ridge, drawn first. */}
        {rows.map((r, idx) => {
          const base = PAD.t + idx * ROW
          const outline = ridgePath(r.smooth, peak, base, 1, xAt)
          return (
            <g key={r.id}>
              <path
                d={`${outline} L${xAt(weeks - 1)},${base} L${xAt(0)},${base} Z`}
                fill="var(--kt-bg, #0b0c0e)"
              />
              {LEVELS.map((level, li) => (
                <path
                  key={level}
                  d={ridgePath(r.smooth, peak, base, level, xAt)}
                  fill="none"
                  stroke="var(--share-accent, var(--kt-hit))"
                  strokeOpacity={li === 0 ? 0.95 : 0.6 - li * 0.1}
                  strokeWidth={li === 0 ? 1.6 : 1}
                />
              ))}
              <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="rgba(var(--kt-ink-rgb), 0.12)" />
              <text x={PAD.l - 10} y={base - 3} fontSize={11} textAnchor="end" fill="var(--kt-ink)">
                {r.name.length > (W < 500 ? 12 : 18) ? `${r.name.slice(0, W < 500 ? 11 : 17)}…` : r.name}
                <title>{r.name}</title>
              </text>
              <text x={PAD.l - 10} y={base + 10} fontSize={9} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.4)">
                {r.total}
              </text>
              {hover != null && r.raw[hover] > 0 && (
                <circle cx={xAt(hover)} cy={base - (r.smooth[hover] / peak) * AMP} r={2.5} fill="var(--kt-ink)" />
              )}
            </g>
          )
        })}

        {hover != null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={8} y2={H - PAD.b} stroke="rgba(var(--kt-ink-rgb), 0.3)" strokeDasharray="2 3" />
            <text x={Math.min(xAt(hover) + 6, W - 120)} y={14} fontSize={10} fill="var(--kt-ink)">
              {`${weekLabel} ${fmt(weekStart(hover))} · ${rows.reduce((n, r) => n + r.raw[hover], 0)}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
