import { useState } from 'react'
import { STATUS_COLOR } from '../../constants/theme'

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

// Bottom to top: finished work is the ground everything else stands on.
const BANDS = [
  { key: 'done', label: 'DONE', fill: 'var(--kt-ink, #f5f6f7)', area: 0.16 },
  { key: 'failed', label: 'FAILED', fill: STATUS_COLOR.failed, area: 0.22 },
  { key: 'in_progress', label: 'IN PROGRESS', fill: STATUS_COLOR.in_progress, area: 0.22 },
  { key: 'todo', label: 'TODO', fill: 'var(--kt-ink, #f5f6f7)', area: 0.05 },
]

const fmt = d => new Date(`${d}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' }).toUpperCase()

/**
 * Status over time as a cumulative flow: every day's tasks stacked by status, so
 * the height is all the work and each band's thickness its share. The current
 * count of each status and its change across the window sit beside it.
 * `data` is `[{ date, todo, in_progress, done, failed }]`, oldest first.
 */
export default function StatusFlow({ data = [], width = 720 }) {
  const [hover, setHover] = useState(null)
  if (data.length < 2) return null
  const mobile = width < 500
  const side = mobile ? 0 : 150
  const W = width, H = mobile ? 180 : 200
  const pad = { t: 10, r: 8 + side, b: 22, l: 30 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const totals = data.map(d => BANDS.reduce((n, b) => n + (d[b.key] || 0), 0))
  const max = Math.max(1, ...totals)
  const xAt = i => pad.l + (i / (data.length - 1)) * iw
  const yAt = v => pad.t + ih - (v / max) * ih

  // Each band's lower and upper edge per day.
  let floor = data.map(() => 0)
  const bands = BANDS.map(b => {
    const lo = floor
    const hi = data.map((d, i) => lo[i] + (d[b.key] || 0))
    floor = hi
    const top = hi.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('')
    const bottom = lo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('')
    return { ...b, shape: `${top}${bottom}Z`, line: top, hi }
  })

  const first = data[0], last = data[data.length - 1]
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((sx - pad.l) / iw) * (data.length - 1))
    setHover(i >= 0 && i < data.length ? i : null)
  }
  const shown = hover != null ? data[hover] : last
  const ticks = data.map((d, i) => i).filter(i => i % 7 === (data.length - 1) % 7)

  const readout = BANDS.slice().reverse().map(b => {
    const now = shown[b.key] || 0
    const delta = (last[b.key] || 0) - (first[b.key] || 0)
    return { ...b, now, delta }
  })

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }} fontFamily={MONO}
        aria-label={readout.map(r => `${r.label} ${r.now}`).join(', ')}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={pad.l} x2={pad.l + iw} y1={yAt(max * f)} y2={yAt(max * f)} stroke="rgba(var(--kt-ink-rgb), 0.08)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={yAt(max * f) + 3} fontSize={8} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.35)">{Math.round(max * f)}</text>
          </g>
        ))}
        {bands.map(b => <path key={b.key} d={b.shape} fill={b.fill} fillOpacity={b.area} />)}
        {bands.map(b => <path key={`l${b.key}`} d={b.line} fill="none" stroke={b.fill} strokeOpacity={b.key === 'todo' ? 0.35 : 0.85} strokeWidth={b.key === 'done' ? 1.2 : 0.8} />)}
        {ticks.map(i => (
          <text key={i} x={xAt(i)} y={H - 6} fontSize={8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fill="rgba(var(--kt-ink-rgb), 0.35)">{fmt(data[i].date)}</text>
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--kt-ink)" strokeOpacity={0.4} strokeDasharray="2 3" />
            {bands.map(b => <circle key={b.key} cx={xAt(hover)} cy={yAt(b.hi[hover])} r={2.2} fill={b.fill} />)}
          </g>
        )}
        {!mobile && (
          <g>
            <text x={W - side + 14} y={pad.t + 8} fontSize={8} fill="rgba(var(--kt-ink-rgb), 0.4)">
              {hover != null ? fmt(data[hover].date) : 'NOW'} · Δ {data.length - 1}D
            </text>
            {readout.map((r, i) => (
              <g key={r.key} transform={`translate(${W - side + 14}, ${pad.t + 30 + i * 36})`}>
                <rect x={0} y={-9} width={6} height={6} fill={r.fill} fillOpacity={r.key === 'todo' ? 0.4 : 0.9} />
                <text x={12} y={-3} fontSize={8} fill="rgba(var(--kt-ink-rgb), 0.5)">{r.label}</text>
                <text x={12} y={14} fontSize={16} fontWeight={700} fill="var(--kt-ink)">{r.now}</text>
                <text x={70} y={14} fontSize={9} fill={r.delta > 0 ? 'rgba(var(--kt-ink-rgb), 0.7)' : 'rgba(var(--kt-ink-rgb), 0.35)'}>
                  {r.delta > 0 ? `▲ +${r.delta}` : r.delta < 0 ? `▼ ${r.delta}` : '— 0'}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {mobile && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6, fontFamily: MONO, fontSize: 10, color: 'var(--kt-muted)' }}>
          {readout.map(r => (
            <span key={r.key}>
              <i style={{ display: 'inline-block', width: 6, height: 6, marginRight: 4, background: r.fill, opacity: r.key === 'todo' ? 0.4 : 0.9 }} />
              {r.label} <b style={{ color: 'var(--kt-ink)' }}>{r.now}</b> {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
