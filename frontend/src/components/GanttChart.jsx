import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STATUS_MAP } from '../constants/theme'
const STATUS_COLOR = Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, v.color]))

const TASK_NAME_W = 220
const ROW_H = 38

function fmtDate(date) {
  return new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

const ZOOM_LEVELS = [
  { labelKey: 'gantt.day', days: 14 },
  { labelKey: 'gantt.week', days: 56 },
  { labelKey: 'gantt.month', days: 120 },
  { labelKey: 'gantt.auto', days: 0 },
]

export default function GanttChart({ tasks }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(3) // default Auto

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tasksWithDates = tasks.filter(t => t.start_date && t.due_date)

  let viewStart, viewEnd
  if (ZOOM_LEVELS[zoom].days > 0) {
    const halfDays = Math.floor(ZOOM_LEVELS[zoom].days / 2)
    viewStart = new Date(today)
    viewStart.setDate(viewStart.getDate() - halfDays)
    viewEnd = new Date(today)
    viewEnd.setDate(viewEnd.getDate() + halfDays)
  } else if (tasksWithDates.length > 0) {
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

  const getLeft = (date) => Math.max(0, ((new Date(date).getTime() - viewStart.getTime()) / totalMs) * 100)
  const getWidth = (start, end) => {
    const l = getLeft(start)
    const r = Math.min(100, ((new Date(end).getTime() - viewStart.getTime()) / totalMs) * 100)
    return Math.max(0.5, r - l)
  }

  // Generate week markers
  const weeks = []
  const d = new Date(viewStart)
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  while (d <= viewEnd) {
    if (d >= viewStart) weeks.push(new Date(d))
    d.setDate(d.getDate() + 7)
  }

  const todayLeft = getLeft(today)

  // Build task index for dependency arrows
  const taskIndex = {}
  const visibleTasks = tasks.filter(t => t.parent_id == null)
  visibleTasks.forEach((t, i) => { taskIndex[t.id] = i })

  // Dependency lines (SVG arrows)
  const depLines = []
  visibleTasks.forEach((task) => {
    if (!task.blocked_by || !task.start_date) return
    task.blocked_by.forEach(depId => {
      const depTask = visibleTasks.find(t => t.id === depId)
      if (!depTask || !depTask.due_date) return
      const fromIdx = taskIndex[depId]
      const toIdx = taskIndex[task.id]
      if (fromIdx === undefined || toIdx === undefined) return
      depLines.push({
        fromLeft: getLeft(depTask.due_date),
        fromRow: fromIdx,
        toLeft: getLeft(task.start_date),
        toRow: toIdx,
      })
    })
  })

  return (
    <div style={{ overflow: 'auto', minHeight: 200 }}>
      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginRight: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('gantt.zoom')}</span>
        {ZOOM_LEVELS.map((z, i) => (
          <button
            key={z.labelKey}
            onClick={() => setZoom(i)}
            style={{
              padding: '3px 10px', borderRadius: 9999, fontSize: 11, cursor: 'pointer',
              border: zoom === i ? 'none' : '1px solid rgba(255,255,255,0.15)',
              background: zoom === i ? 'rgba(30,215,96,0.12)' : 'transparent',
              color: zoom === i ? '#1ed760' : '#b3b3b3',
              fontWeight: zoom === i ? 700 : 400,
            }}
          >
            {t(z.labelKey)}
          </button>
        ))}
      </div>

      {/* Header */}
      <div style={{
        display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)',
        position: 'sticky', top: 0, background: '#121212', zIndex: 2,
      }}>
        <div style={{
          width: TASK_NAME_W, minWidth: TASK_NAME_W, flexShrink: 0,
          padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
          borderRight: '1px solid rgba(255,255,255,0.05)',
        }}>
          {t('gantt.issue')}
        </div>
        <div style={{ flex: 1, position: 'relative', height: 33, minWidth: 400 }}>
          {weeks.map((week, i) => {
            const left = getLeft(week)
            const nextLeft = i + 1 < weeks.length ? getLeft(weeks[i + 1]) : 100
            return (
              <div key={i}>
                <div style={{ position: 'absolute', left: `${left}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.05)' }} />
                <div style={{
                  position: 'absolute', left: `${left}%`, width: `${nextLeft - left}%`,
                  padding: '8px 4px', fontSize: 11, color: 'rgba(255,255,255,0.25)',
                  overflow: 'hidden', whiteSpace: 'nowrap',
                }}>
                  {fmtDate(week)}
                </div>
              </div>
            )
          })}
          <div style={{ position: 'absolute', left: `${todayLeft}%`, top: 4 }}>
            <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700, marginLeft: 3, whiteSpace: 'nowrap' }}>
              {t('gantt.today')}
            </span>
          </div>
        </div>
      </div>

      {/* Rows */}
      {visibleTasks.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
          {t('gantt.noIssues')}
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Dependency arrows SVG overlay */}
          {depLines.length > 0 && (
            <svg
              style={{
                position: 'absolute', top: 0, left: TASK_NAME_W, right: 0,
                width: `calc(100% - ${TASK_NAME_W}px)`, height: visibleTasks.length * ROW_H,
                pointerEvents: 'none', zIndex: 3,
              }}
            >
              <defs>
                <marker id="dep-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <polygon points="0,0 6,2 0,4" fill="#ffa42b" opacity="0.6" />
                </marker>
              </defs>
              {depLines.map((line, i) => {
                const svgW = 1 // will use % but need to approximate
                const fromX = `${line.fromLeft}%`
                const fromY = line.fromRow * ROW_H + ROW_H / 2
                const toX = `${line.toLeft}%`
                const toY = line.toRow * ROW_H + ROW_H / 2
                return (
                  <line
                    key={i}
                    x1={fromX} y1={fromY}
                    x2={toX} y2={toY}
                    stroke="#ffa42b" strokeWidth="1.5" opacity="0.5"
                    strokeDasharray="4 2"
                    markerEnd="url(#dep-arrow)"
                  />
                )
              })}
            </svg>
          )}

          {visibleTasks.map(task => {
            const hasDates = task.start_date && task.due_date
            const barWidth = hasDates ? getWidth(task.start_date, task.due_date) : 0
            return (
              <div key={task.id} style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', height: ROW_H }}>
                <div style={{
                  width: TASK_NAME_W, minWidth: TASK_NAME_W, flexShrink: 0,
                  padding: '0 16px', display: 'flex', alignItems: 'center',
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{ fontSize: 13, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </span>
                </div>

                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 400 }}>
                  {weeks.map((week, i) => (
                    <div key={i} style={{ position: 'absolute', left: `${getLeft(week)}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.03)' }} />
                  ))}
                  <div style={{ position: 'absolute', left: `${todayLeft}%`, top: 0, bottom: 0, width: 1.5, background: 'rgba(248,113,113,0.5)', zIndex: 1 }} />
                  {hasDates ? (
                    <div
                      title={`${fmtDate(task.start_date)} \u2192 ${fmtDate(task.due_date)}`}
                      style={{
                        position: 'absolute',
                        left: `${getLeft(task.start_date)}%`,
                        width: `${barWidth}%`,
                        top: '50%', transform: 'translateY(-50%)',
                        height: 20, minWidth: 8,
                        background: STATUS_COLOR[task.status] || '#94a3b8',
                        borderRadius: 4, zIndex: 2, opacity: 0.85,
                        cursor: 'default',
                        display: 'flex', alignItems: 'center', overflow: 'hidden',
                      }}
                    >
                      {barWidth > 3 && (
                        <span style={{ fontSize: 10, color: '#fff', padding: '0 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {task.title}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      position: 'absolute', left: `${todayLeft}%`, top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 8, height: 8, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', zIndex: 2,
                    }} title="No dates set" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLOR).map(([s, c]) => {
          const STATUS_LEGEND_KEYS = { todo: 'todo', in_progress: 'inProgress', done: 'done', failed: 'failed' }
          return (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
              {STATUS_LEGEND_KEYS[s] ? t(STATUS_LEGEND_KEYS[s]) : s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          )
        })}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
          <span style={{ width: 10, height: 10, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', display: 'inline-block' }} />
          {t('gantt.noDates')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
          <svg width="16" height="10"><line x1="0" y1="5" x2="16" y2="5" stroke="#ffa42b" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.5" /></svg>
          Dependency
        </span>
      </div>
    </div>
  )
}
