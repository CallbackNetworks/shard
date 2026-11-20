import { useMemo, useState } from 'react'

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"
const DAY = 86400000
const MIN_WEEKS = 13
const LEAD_WEEKS = 2
const ROWS = ['MON', '', 'WED', '', 'FRI', '', '']

const iso = d => d.toISOString().slice(0, 10)
const fmt = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' }).toUpperCase()

// The weeks worth drawing: from shortly before the first day with any activity
// to today, never fewer than a quarter. A year of empty squares before the work
// began says nothing and squeezes the part that does.
export function stripWeeks(data, today = new Date(), fill = MIN_WEEKS) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const active = data.filter(d => d.count > 0).map(d => d.date).sort()
  const first = active.length ? new Date(`${active[0]}T00:00:00Z`) : end
  let start = new Date(first.getTime() - LEAD_WEEKS * 7 * DAY)
  // At least a quarter, and at least as many weeks as fill the width at full cell size.
  const floor = new Date(end.getTime() - (Math.max(MIN_WEEKS, fill) * 7 - 1) * DAY)
  if (start > floor) start = floor
  const year = new Date(end.getTime() - 364 * DAY)
  if (start < year) start = year
  // Weeks start on Monday.
  start = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY)
  const weeks = Math.ceil((end - start) / DAY / 7 + 1 / 7)
  return { start, end, weeks }
}

// Consecutive days with activity, ending today or yesterday.
export function streak(counts, end) {
  let n = 0
  let d = new Date(end)
  if (!counts.get(iso(d))) d = new Date(d.getTime() - DAY)
  while (counts.get(iso(d)) > 0) { n++; d = new Date(d.getTime() - DAY) }
  return n
}

/**
 * Daily activity as a strip of weeks that fills its width: brightness is the
 * day's count, today is framed, and the last few days breathe. `data` is
 * `[{ date: 'YYYY-MM-DD', count }]`.
 */
export default function ActivityStrip({ data = [], width = 720 }) {
  const [hover, setHover] = useState(null)
  const left = 30
  const gap = 2
  const MAX_CELL = 26
  const model = useMemo(() => {
    const counts = new Map(data.map(d => [d.date, d.count]))
    const { start, end, weeks } = stripWeeks(data, new Date(), Math.floor((width - left) / (MAX_CELL + gap)))
    const cells = []
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        const day = new Date(start.getTime() + (w * 7 + r) * DAY)
        if (day > end) continue
        cells.push({ w, r, day, count: counts.get(iso(day)) || 0 })
      }
    }
    const max = Math.max(1, ...cells.map(c => c.count))
    const total = cells.reduce((n, c) => n + c.count, 0)
    const busiest = cells.reduce((b, c) => (c.count > b.count ? c : b), { count: 0 })
    const last30 = cells.filter(c => end - c.day < 30 * DAY).reduce((n, c) => n + c.count, 0)
    return { cells, weeks, max, total, busiest, last30, end, streak: streak(counts, end) }
  }, [data, width])

  const W = width
  const cell = Math.min(MAX_CELL, (W - left) / model.weeks - gap)
  const top = 16
  const H = top + 7 * (cell + gap) + 4
  const x = w => left + w * (cell + gap)
  const y = r => top + r * (cell + gap)

  // A month label over the first week that starts in it.
  const months = []
  for (let w = 0; w < model.weeks; w++) {
    const day = model.cells.find(c => c.w === w)?.day
    if (!day) continue
    const prev = model.cells.find(c => c.w === w - 1)?.day
    if (!prev || prev.getUTCMonth() !== day.getUTCMonth()) months.push({ w, label: day.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase() })
  }

  const readout = [
    `${model.total} UPDATES`,
    model.busiest.count > 0 ? `BUSIEST ${fmt(model.busiest.day)} · ${model.busiest.count}` : null,
    `STREAK ${model.streak}D`,
    `LAST 30D ${model.last30}`,
  ].filter(Boolean).join('  ·  ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={readout} style={{ display: 'block' }} fontFamily={MONO}>
        {months.map(m => (
          <text key={m.w} x={x(m.w)} y={10} fontSize={8} fill="rgba(var(--kt-ink-rgb), 0.4)">{m.label}</text>
        ))}
        {ROWS.map((label, r) => label && (
          <text key={r} x={left - 6} y={y(r) + cell * 0.72} fontSize={7} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.3)">{label}</text>
        ))}
        {model.cells.map(c => {
          const t = c.count / model.max
          const age = (model.end - c.day) / DAY
          const fresh = c.count > 0 && age < 3
          const isToday = age < 1
          const on = hover && hover.day.getTime() === c.day.getTime()
          return (
            <g key={`${c.w}-${c.r}`} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}>
              <rect
                x={x(c.w)} y={y(c.r)} width={cell} height={cell}
                fill="var(--kt-ink, #f5f6f7)"
                fillOpacity={c.count ? 0.16 + 0.84 * Math.sqrt(t) : 0.045}
                className={fresh ? 'kt-breathe' : undefined}
                style={fresh ? { '--breath-period': '4.5s', '--breath-lo': '0.55' } : undefined}
              />
              {(isToday || on) && (
                <rect x={x(c.w) - 1.5} y={y(c.r) - 1.5} width={cell + 3} height={cell + 3} fill="none" stroke="var(--kt-ink, #f5f6f7)" strokeOpacity={on ? 0.9 : 0.6} strokeWidth={0.8} />
              )}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 8, fontFamily: MONO, fontSize: 10, color: 'var(--kt-muted)' }}>
        <span>{hover ? `${fmt(hover.day)} · ${hover.count} UPDATE${hover.count === 1 ? '' : 'S'}` : readout}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          LESS
          {[0.045, 0.3, 0.55, 0.8, 1].map(o => <i key={o} style={{ width: 8, height: 8, background: 'var(--kt-ink, #f5f6f7)', opacity: o }} />)}
          MORE
        </span>
      </div>
    </div>
  )
}
