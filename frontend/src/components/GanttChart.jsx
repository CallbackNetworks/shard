import { STATUS_MAP } from '../constants/theme'
const STATUS_COLOR = Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, v.color]))

const TASK_NAME_W = 220

function fmtDate(date) {
  return new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export default function GanttChart({ tasks }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tasksWithDates = tasks.filter(t => t.start_date && t.due_date)

  let viewStart, viewEnd
  if (tasksWithDates.length > 0) {
    const starts = tasksWithDates.map(t => new Date(t.start_date).getTime())
    const ends = tasksWithDates.map(t => new Date(t.due_date).getTime())
    viewStart = new Date(Math.min(...starts, today.getTime()))
    viewEnd = new Date(Math.max(...ends, today.getTime()))
    viewStart.setDate(viewStart.getDate() - 3)
    viewEnd.setDate(viewEnd.getDate() + 3)
  } else {
    viewStart = new Date(today)
    viewStart.setDate(1)
    viewEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0)
  }

  const totalMs = viewEnd.getTime() - viewStart.getTime()
  const totalDays = totalMs / 86400000

  const getLeft = (date) => Math.max(0, ((new Date(date).getTime() - viewStart.getTime()) / totalMs) * 100)
  const getWidth = (start, end) => {
    const l = getLeft(start)
    const r = Math.min(100, ((new Date(end).getTime() - viewStart.getTime()) / totalMs) * 100)
    return Math.max(0.5, r - l)
  }

  // Generate week markers starting from nearest Monday before viewStart
  const weeks = []
  const d = new Date(viewStart)
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  while (d <= viewEnd) {
    if (d >= viewStart) weeks.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }

  const todayLeft = getLeft(today)

  return (
    <div style={{ overflow: 'auto', minHeight: 200 }}>
      {/* Header */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e5e7eb',
        position: 'sticky', top: 0, background: '#fff', zIndex: 2,
      }}>
        <div style={{
          width: TASK_NAME_W, minWidth: TASK_NAME_W, flexShrink: 0,
          padding: '8px 16px', fontSize: 11, fontWeight: 600, color: '#6b7280',
          borderRight: '1px solid #f3f4f6',
        }}>
          ISSUE
        </div>
        <div style={{ flex: 1, position: 'relative', height: 33, minWidth: 400 }}>
          {weeks.map((week, i) => {
            const left = getLeft(week)
            const nextLeft = i + 1 < weeks.length ? getLeft(weeks[i + 1]) : 100
            return (
              <div key={i}>
                <div style={{ position: 'absolute', left: `${left}%`, top: 0, bottom: 0, width: 1, background: '#f3f4f6' }} />
                <div style={{
                  position: 'absolute', left: `${left}%`, width: `${nextLeft - left}%`,
                  padding: '8px 4px', fontSize: 11, color: '#9ca3af',
                  overflow: 'hidden', whiteSpace: 'nowrap',
                }}>
                  {fmtDate(week)}
                </div>
              </div>
            )
          })}
          {/* Today label */}
          <div style={{ position: 'absolute', left: `${todayLeft}%`, top: 4 }}>
            <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, marginLeft: 3, whiteSpace: 'nowrap' }}>
              Today
            </span>
          </div>
        </div>
      </div>

      {/* Rows */}
      {tasks.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No issues yet
        </div>
      ) : (
        tasks.map(task => {
          const hasDates = task.start_date && task.due_date
          return (
            <div key={task.id} style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', minHeight: 38 }}>
              <div style={{
                width: TASK_NAME_W, minWidth: TASK_NAME_W, flexShrink: 0,
                padding: '0 16px', display: 'flex', alignItems: 'center',
                borderRight: '1px solid #f3f4f6',
              }}>
                <span style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.title}
                </span>
              </div>

              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 400 }}>
                {/* Week separators */}
                {weeks.map((week, i) => (
                  <div key={i} style={{ position: 'absolute', left: `${getLeft(week)}%`, top: 0, bottom: 0, width: 1, background: '#f9fafb' }} />
                ))}
                {/* Today line */}
                <div style={{ position: 'absolute', left: `${todayLeft}%`, top: 0, bottom: 0, width: 1.5, background: '#fca5a5', zIndex: 1 }} />
                {/* Bar or dot */}
                {hasDates ? (
                  <div
                    title={`${fmtDate(task.start_date)} → ${fmtDate(task.due_date)}`}
                    style={{
                      position: 'absolute',
                      left: `${getLeft(task.start_date)}%`,
                      width: `${getWidth(task.start_date, task.due_date)}%`,
                      top: '50%', transform: 'translateY(-50%)',
                      height: 20, minWidth: 8,
                      background: STATUS_COLOR[task.status] || '#94a3b8',
                      borderRadius: 4, zIndex: 2, opacity: 0.85,
                      cursor: 'default',
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#fff', padding: '0 5px', whiteSpace: 'nowrap', overflow: 'hidden', display: 'block', lineHeight: '20px' }}>
                      {task.title.length > 10 ? '' : task.title}
                    </span>
                  </div>
                ) : (
                  <div style={{
                    position: 'absolute', left: `${todayLeft}%`, top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 8, height: 8, background: '#d1d5db', borderRadius: '50%', zIndex: 2,
                  }} title="No dates set" />
                )}
              </div>
            </div>
          )
        })
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, padding: '10px 16px', borderTop: '1px solid #f3f4f6' }}>
        {Object.entries(STATUS_COLOR).map(([s, c]) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
          <span style={{ width: 10, height: 10, background: '#d1d5db', borderRadius: '50%', display: 'inline-block' }} />
          No dates
        </span>
      </div>
    </div>
  )
}
