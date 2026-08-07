import { useState } from 'react'
import { Bar, Label, urgencyScore, urgencyColor } from '../OverviewViews'
import { STATUS_COLOR } from '../../constants/theme'
import useScrollReveal from './useScrollReveal'
import GuestNotes from './GuestNotes'
import { relativeTime, formatMinutes, formatDate } from './utils'

const STATUS_COLOR_MAP = STATUS_COLOR
const STATUS_LABEL = { done: 'DONE', in_progress: 'ACTIVE', failed: 'FAILED', todo: 'TODO' }
const PRI_COLOR = { high: '#facc15', medium: '#f0b429', low: 'rgba(var(--kt-ink-rgb), 0.35)' }

function hasDetails(task) {
  return task.description || task.progress_pct != null || task.start_date ||
    task.time_estimate || task.time_spent ||
    (task.subtasks && task.subtasks.length > 0) ||
    (task.blocked_by && task.blocked_by.length > 0) ||
    (task.blocking && task.blocking.length > 0)
}

function TaskRow({ task, index, bp, share }) {
  const [open, setOpen] = useState(false)
  const sc = STATUS_COLOR_MAP[task.status] || 'rgba(var(--kt-ink-rgb), 0.28)'
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  const isMobile = bp === 'mobile'
  const expandable = hasDetails(task) || share.enabled

  return (
    <div>
      <div
        onClick={expandable ? () => setOpen(v => !v) : undefined}
        className={[
          'kt-share-task-row',
          isMobile ? 'is-mobile' : '',
          index % 2 === 0 ? 'is-alt' : '',
          expandable ? 'is-expandable' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--task-color': sc }}
      >
        <div className="kt-share-task-main">
          {expandable && (
            <span className="kt-share-task-chevron">
              {open ? '▾' : '▸'}
            </span>
          )}
          <span className="kt-share-task-dot" />
          <span className={task.status === 'done' ? 'kt-share-task-title is-done' : 'kt-share-task-title'}>
            {task.title}
          </span>
        </div>
        <div className="kt-share-task-meta">
          {isOverdue && <Label color={STATUS_COLOR.failed}>OVERDUE</Label>}
          {task.labels?.map((l, i) => (
            <span key={i} className="kt-share-label" style={{ '--label-color': l.color }}>
              {l.name}
            </span>
          ))}
          {task.subtask_count > 0 && (
            <span>
              {task.subtask_count} sub
            </span>
          )}
          {task.comment_count > 0 && (
            <span>
              {task.comment_count} cmt
            </span>
          )}
          <span style={{ color: PRI_COLOR[task.priority] || 'rgba(var(--kt-ink-rgb), 0.28)' }}>
            {(task.priority || '').toUpperCase()}
          </span>
          {task.due_date && (
            <span className={isOverdue ? 'is-overdue' : ''}>
              {relativeTime(task.due_date)}
            </span>
          )}
          <span className="kt-share-task-status" style={{ color: sc }}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
        </div>
      </div>

      {/* Expanded detail panel */}
      {open && (
        <div className="kt-share-task-detail" style={{ '--task-color': sc }}>
          {task.description && (
            <div className="kt-share-task-description">
              {task.description.length > 200 ? task.description.slice(0, 200) + '...' : task.description}
            </div>
          )}

          {/* Metadata row */}
          <div className="kt-share-task-detail-grid">
            {task.start_date && (
              <span>Start: <b>{formatDate(task.start_date)}</b></span>
            )}
            {task.due_date && (
              <span>Due: <b className={isOverdue ? 'is-overdue' : ''}>{formatDate(task.due_date)}</b></span>
            )}
            {task.progress_pct != null && (
              <span className="kt-share-task-progress">
                <span>
                  <Bar pct={task.progress_pct} color={sc} height={3} bg="rgba(var(--kt-ink-rgb), 0.06)" />
                </span>
                <b>{task.progress_pct}%</b>
              </span>
            )}
            {(task.time_estimate || task.time_spent) && (
              <span>
                Time: <b>{formatMinutes(task.time_spent || 0)}</b>
                {task.time_estimate && <span> / {formatMinutes(task.time_estimate)} est</span>}
              </span>
            )}
          </div>

          {/* Subtask list */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="kt-share-subtasks">
              <div className="kt-share-mini-label">
                SUBTASKS ({task.subtasks.length})
              </div>
              {task.subtasks.map(s => {
                const sColor = STATUS_COLOR_MAP[s.status] || 'rgba(var(--kt-ink-rgb), 0.28)'
                return (
                  <div key={s.id} className="kt-share-subtask" style={{ '--task-color': sColor }}>
                    <span />
                    <b className={s.status === 'done' ? 'is-done' : ''}>
                      {s.title}
                    </b>
                    <em>
                      {STATUS_LABEL[s.status] || s.status}
                    </em>
                  </div>
                )
              })}
            </div>
          )}

          {/* Dependencies */}
          {(task.blocked_by?.length > 0 || task.blocking?.length > 0) && (
            <div className="kt-share-dependencies">
              {task.blocked_by?.length > 0 && (
                <span>
                  Blocked by: {task.blocked_by.map(d => d.title || d.id).join(', ')}
                </span>
              )}
              {task.blocking?.length > 0 && (
                <span className="is-info">
                  Blocking: {task.blocking.map(d => d.title || d.id).join(', ')}
                </span>
              )}
            </div>
          )}

          {/* Guest notes */}
          {share.enabled && (
            <div className="kt-share-task-notes">
              <div className="kt-share-mini-label">
                NOTES ({(task.comments || []).length})
              </div>
              <GuestNotes
                token={share.token}
                projectId={share.projectId}
                taskId={task.id}
                notes={task.comments}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ShareProjectCard({ project, index: _index, bp, token, guestNotesEnabled }) {
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
    <div
      ref={ref}
      className={visible ? 'kt-share-project is-visible' : 'kt-share-project'}
      style={{ '--share-accent': color }}
    >
      <div className={isMobile ? 'kt-share-project-head is-mobile' : 'kt-share-project-head'}>
        <div className="kt-share-project-topline">
          <div className="kt-share-project-title-row">
            <span className="kt-share-project-name">
              {project.name}
            </span>
            {overdue > 0 && <Label color={STATUS_COLOR.failed}>{overdue} overdue</Label>}
            {project.active_cycle && (
              <Label color={STATUS_COLOR.in_progress}>
                {project.active_cycle.name} {Math.round(project.active_cycle.progress)}%
                {project.active_cycle.start_date && project.active_cycle.end_date && (
                  <span className="kt-share-cycle-date">
                    {formatDate(project.active_cycle.start_date)} - {formatDate(project.active_cycle.end_date)}
                  </span>
                )}
              </Label>
            )}
          </div>
          <div className="kt-share-project-score">
            <span>
              {pct}<b>%</b>
            </span>
            <em>{project.done_tasks}/{total}</em>
          </div>
        </div>

        {project.description && (
          <div className="kt-share-project-description">
            {project.description.length > 150
              ? project.description.slice(0, 150) + '...'
              : project.description}
          </div>
        )}

        <Bar pct={pct} color={color} height={5} />

        <div className="kt-share-project-counts">
          {[[STATUS_COLOR.done, done, 'done'], [STATUS_COLOR.in_progress, active, 'active'], [STATUS_COLOR.failed, failed, 'failed']].map(([c, n, l]) => (
            <span key={l} style={{ color: n > 0 ? c : 'rgba(var(--kt-ink-rgb), 0.18)' }}>
              {n} <b>{l}</b>
            </span>
          ))}
        </div>

        {project.labels?.length > 0 && (
          <div className="kt-share-project-labels">
            {project.labels.map((l, i) => (
              <span key={i} className="kt-share-label" style={{ '--label-color': l.color }}>
                {l.name}
              </span>
            ))}
          </div>
        )}

        {project.repo_url && (
          <div className="kt-share-repo">
            <a
              href={project.repo_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {project.repo_url.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}
      </div>

      {visibleTasks.map((t, i) => (
        <TaskRow
          key={t.id}
          task={t}
          index={i}
          bp={bp}
          share={{ token, projectId: project.id, enabled: !!guestNotesEnabled }}
        />
      ))}

      {hasMore && (
        <button onClick={() => setExpanded(!expanded)} className="kt-share-show-more">
          {expanded ? 'SHOW LESS' : `SHOW ALL ${tasks.length} TASKS`}
        </button>
      )}

      {guestNotesEnabled && (
        <div className="kt-share-project-notes">
          <div className="kt-share-mini-label">
            PROJECT NOTES ({(project.notes || []).length})
          </div>
          <GuestNotes token={token} projectId={project.id} notes={project.notes} />
        </div>
      )}
    </div>
  )
}
