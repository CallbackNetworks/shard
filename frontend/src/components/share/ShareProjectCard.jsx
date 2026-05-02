import { useState } from 'react'
import { DIM, HI, MID, Bar, Label, urgencyScore, urgencyColor } from '../OverviewViews'
import useScrollReveal from './useScrollReveal'
import { relativeTime } from './utils'

const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`
const PARA = (px = 8) => `polygon(${px}px 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

const STATUS_COLOR = { done: '#22c55e', in_progress: '#38bdf8', failed: '#f87171', todo: 'rgba(255,255,255,0.2)' }
const STATUS_LABEL = { done: 'DONE', in_progress: 'ACTIVE', failed: 'FAILED', todo: 'TODO' }
const PRI_COLOR = { high: '#f87171', medium: '#f0b429', low: 'rgba(255,255,255,0.35)' }

function TaskRow({ task, index, bp }) {
  const sc = STATUS_COLOR[task.status] || DIM
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  const isMobile = bp === 'mobile'

  return (
    <div style={{
      display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? 4 : 12,
      padding: isMobile ? '8px 16px 8px 24px' : '7px 20px 7px 28px',
      background: index % 2 === 0 ? 'rgba(255,255,255,0.008)' : 'transparent',
      borderLeft: `2px solid ${sc}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, width: '100%' }}>
        <span style={{
          width: 7, height: 7, flexShrink: 0,
          background: sc, clipPath: PARA(3),
        }} />
        <span style={{
          flex: 1, fontSize: 12,
          color: task.status === 'done' ? 'rgba(255,255,255,0.2)' : MID,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
        </span>
      </div>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        paddingLeft: isMobile ? 17 : 0,
        flexWrap: 'wrap',
      }}>
        {isOverdue && <Label color="#ff5533">OVERDUE</Label>}
        {task.labels?.map((l, i) => (
          <span key={i} style={{
            fontSize: 9, fontWeight: 700, color: l.color,
            background: `${l.color}14`, padding: '1px 5px',
            letterSpacing: '0.06em',
          }}>
            {l.name}
          </span>
        ))}
        {task.subtask_count > 0 && (
          <span style={{ fontSize: 10, color: DIM }}>
            {task.subtask_count} sub
          </span>
        )}
        {task.comment_count > 0 && (
          <span style={{ fontSize: 10, color: DIM }}>
            {task.comment_count} cmt
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 700, color: PRI_COLOR[task.priority] || DIM,
          letterSpacing: '0.06em',
        }}>
          {(task.priority || '').toUpperCase()}
        </span>
        {task.due_date && (
          <span style={{
            fontSize: 10, color: isOverdue ? '#ff5533' : 'rgba(255,255,255,0.2)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {relativeTime(task.due_date)}
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 700, color: sc,
          letterSpacing: '0.06em', minWidth: 44, textAlign: 'right',
        }}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
      </div>
    </div>
  )
}

export default function ShareProjectCard({ project, index, bp }) {
  const [expanded, setExpanded] = useState(false)
  const [ref, visible] = useScrollReveal(0.1)
  const u = urgencyScore(project)
  const color = urgencyColor(u)
  const pct = Math.round(project.progress || 0)
  const tasks = project.tasks || []
  const done = tasks.filter(t => t.status === 'done').length
  const active = tasks.filter(t => t.status === 'in_progress').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length
  const total = project.total_tasks || 0
  const visibleTasks = expanded ? tasks : tasks.slice(0, 5)
  const hasMore = tasks.length > 5
  const isMobile = bp === 'mobile'

  return (
    <div ref={ref} style={{
      marginBottom: 10,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(24px)',
      transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
    }}>
      <div style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.022)',
        borderTop: `1px solid ${color}33`,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        padding: isMobile ? '16px 16px 14px 20px' : '16px 24px 14px 28px',
        clipPath: isMobile ? 'none' : PARA_R(18),
        transition: 'background 0.2s, transform 0.2s',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: color, transition: 'width 0.2s',
        }} />

        <div style={{
          display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between', gap: 10, marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 13, fontWeight: 800, color: HI, letterSpacing: '0.05em',
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {project.name}
            </span>
            {overdue > 0 && <Label color="#ff5533">{'⚠'} {overdue} overdue</Label>}
            {project.active_cycle && (
              <Label color="#38bdf8">
                {project.active_cycle.name} {Math.round(project.active_cycle.progress)}%
              </Label>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
            <span style={{
              fontSize: 26, fontWeight: 900, color, letterSpacing: '-0.04em', lineHeight: 1,
            }}>
              {pct}<span style={{ fontSize: 12, fontWeight: 500, color: DIM }}>%</span>
            </span>
            <span style={{ fontSize: 11, color: DIM }}>{project.done_tasks}/{total}</span>
          </div>
        </div>

        <Bar pct={pct} color={color} height={5} />

        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {[['#22c55e', done, 'done'], ['#38bdf8', active, 'active'], ['#f87171', failed, 'failed']].map(([c, n, l]) => (
            <span key={l} style={{
              fontSize: 11, color: n > 0 ? c : 'rgba(255,255,255,0.15)',
              fontWeight: 700, letterSpacing: '0.04em',
            }}>
              {n} <span style={{ fontWeight: 400, opacity: 0.6 }}>{l}</span>
            </span>
          ))}
        </div>

        {project.labels?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {project.labels.map((l, i) => (
              <span key={i} style={{
                fontSize: 9, fontWeight: 700, color: l.color,
                background: `${l.color}14`, border: `1px solid ${l.color}33`,
                padding: '1px 7px', letterSpacing: '0.08em', textTransform: 'uppercase',
                transform: 'skewX(-4deg)',
              }}>
                <span style={{ display: 'inline-block', transform: 'skewX(4deg)' }}>{l.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {visibleTasks.map((t, i) => (
        <TaskRow key={t.id} task={t} index={i} bp={bp} />
      ))}

      {hasMore && (
        <button onClick={() => setExpanded(!expanded)} style={{
          width: '100%', background: 'rgba(255,255,255,0.015)',
          border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)',
          padding: '8px 0', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, color: DIM,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          transition: 'color 0.15s, background 0.15s',
          fontFamily: 'inherit',
        }}>
          {expanded ? 'SHOW LESS' : `SHOW ALL ${tasks.length} TASKS`}
        </button>
      )}
    </div>
  )
}
