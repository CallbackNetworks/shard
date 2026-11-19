import { STATUS_COLOR } from '../../constants/theme'
import { isOverdue } from '../../utils/overdue'
import { formatDate } from './utils'
import s from './ShareNow.module.css'

const SEGMENTS = [
  ['done', 'done'],
  ['in_progress', 'active'],
  ['failed', 'failed'],
  ['todo', 'todo'],
]
const MAX_ACTIVE = 8

// The server buckets by UTC calendar day; reading "2026-11-19" as midnight UTC
// would name the previous day anywhere west of Greenwich.
const dayLabel = date => formatDate(`${date}T12:00:00`)

// Anything outside the four built-in states is still open work, so it is drawn as todo.
function statusCounts(tasks) {
  const counts = { done: 0, in_progress: 0, failed: 0, todo: 0 }
  for (const t of tasks) counts[t.status in counts ? t.status : 'todo'] += 1
  return counts
}

function ActiveWork({ projects }) {
  const now = new Date()
  const active = projects.flatMap(p =>
    (p.tasks || []).filter(t => t.status === 'in_progress').map(t => ({ ...t, project: p.name })),
  )
  // Late work first, then whatever is due soonest; undated work last.
  active.sort((a, b) => {
    const lateA = isOverdue(a, now), lateB = isOverdue(b, now)
    if (lateA !== lateB) return lateA ? -1 : 1
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1
    return (a.due_date || '').localeCompare(b.due_date || '')
  })

  return (
    <div className={s.panel}>
      <div className={s.heading}>In progress <b>{active.length}</b></div>
      {active.length === 0 ? (
        <div className={s.empty}>Nothing in progress right now.</div>
      ) : (
        <ul className={s.active}>
          {active.slice(0, MAX_ACTIVE).map(t => {
            const late = isOverdue(t, now)
            const pct = t.progress_pct ?? (t.subtask_count
              ? Math.round(t.subtasks.filter(x => x.status === 'done').length / t.subtask_count * 100)
              : null)
            return (
              <li key={t.id}>
                <span className={s.title} title={t.title}>{t.title}</span>
                <span className={s.project}>{t.project}</span>
                {/* No measure is not 0%: an empty track would say the second. */}
                {pct == null ? <span /> : (
                  <span className={s.meter} aria-label={`${pct}%`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                )}
                <span className={late ? `${s.due} ${s.late}` : s.due}>
                  {t.due_date ? formatDate(t.due_date) : '—'}
                </span>
              </li>
            )
          })}
          {active.length > MAX_ACTIVE && (
            <li className={s.more}>+{active.length - MAX_ACTIVE} more below</li>
          )}
        </ul>
      )}
    </div>
  )
}

function ProjectStatus({ projects }) {
  const rows = projects.map(p => ({ id: p.id, name: p.name, total: (p.tasks || []).length, counts: statusCounts(p.tasks || []) }))
    .filter(r => r.total > 0)
  if (rows.length === 0) return null

  return (
    <div className={s.panel}>
      <div className={s.heading}>By project</div>
      <ul className={s.bars}>
        {rows.map(r => (
          <li key={r.id}>
            <span className={s.title} title={r.name}>{r.name}</span>
            <span className={s.stack} aria-label={SEGMENTS.map(([k, l]) => `${r.counts[k]} ${l}`).join(', ')}>
              {SEGMENTS.map(([k]) => r.counts[k] > 0 && (
                <span key={k} style={{ flexGrow: r.counts[k], background: STATUS_COLOR[k] }} />
              ))}
            </span>
            <span className={s.count}>{r.counts.done}/{r.total}</span>
          </li>
        ))}
      </ul>
      <div className={s.legend}>
        {SEGMENTS.map(([k, l]) => (
          <span key={k}><i style={{ background: STATUS_COLOR[k] }} />{l}</span>
        ))}
      </div>
    </div>
  )
}

function ActivityDays({ daily }) {
  const total = daily.reduce((n, d) => n + d.count, 0)
  // Fourteen empty columns say nothing the zero beside them would not.
  if (total === 0) return null
  const peak = Math.max(1, ...daily.map(d => d.count))

  return (
    <div className={s.panel}>
      <div className={s.heading}>Activity · {daily.length} days <b>{total}</b></div>
      <div className={s.days} role="img" aria-label={`${total} updates in the last ${daily.length} days`}>
        {daily.map(d => (
          <span key={d.date} title={`${dayLabel(d.date)}: ${d.count}`}>
            <span style={{ height: `${d.count === 0 ? 0 : Math.max(6, d.count / peak * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className={s.axis}>
        <span>{dayLabel(daily[0].date)}</span>
        <span>today</span>
      </div>
    </div>
  )
}

export default function ShareNow({ projects, daily }) {
  if (projects.length === 0) return null
  return (
    <section className={s.now} aria-label="Current state">
      <ActiveWork projects={projects} />
      <div className={s.side}>
        <ProjectStatus projects={projects} />
        <ActivityDays daily={daily} />
      </div>
    </section>
  )
}
