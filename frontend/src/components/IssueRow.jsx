import { useState, memo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Pencil, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw, FileText, MessageSquare, GitBranch, Repeat2, Paperclip, Bot, Activity, Pin, ExternalLink, GitPullRequestArrow, Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { regenerateToken, createExternalIssue } from '../api/client'
import { PRIORITY, DARK } from '../constants/theme'
import { PriorityIcon, StatusIcon, LabelChip, PrBadge, TypeBadge } from './TaskIcons'
import TaskEditForm from './TaskEditForm'
import CommentsPanel from './CommentsPanel'
import DependenciesPanel from './DependenciesPanel'
import MembershipPanel from './MembershipPanel'
import RecurrencePanel from './RecurrencePanel'
import AttachmentsPanel from './AttachmentsPanel'
import BuildHistoryPanel from './BuildHistoryPanel'
import WebhookPanel from './WebhookPanel'
import MarkdownPreview from './MarkdownPreview'
import TimeTracker from './TimeTracker'

// Row badges are buttons, not styled spans: each one toggles a panel, and a row
// carries up to four of them — as <span onClick> none were reachable by Tab,
// multiplied across every task in the list.
const BADGE_BUTTON = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  background: 'none', border: 'none', padding: 0, font: 'inherit',
  fontSize: 10, cursor: 'pointer', flexShrink: 0,
}

/**
 * The due date, editable where it is shown. It used to be read-only text, so
 * setting one meant hovering the row, opening the 12-control edit form, saving
 * and closing — four steps for one field the row already had a column for.
 */
function DueDateCell({ task, hovered, onUpdate }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const iso = task.due_date ? task.due_date.split('T')[0] : ''

  const commit = (next) => {
    setEditing(false)
    if (next === iso) return
    onUpdate(task.id, { due_date: next ? new Date(next).toISOString() : null })
  }

  if (editing) {
    return (
      <input
        type="date"
        defaultValue={iso}
        autoFocus
        onClick={e => e.stopPropagation()}
        onChange={e => commit(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
        style={{
          fontSize: 11, background: DARK.elevated, color: DARK.text,
          border: `1px solid ${DARK.border}`, borderRadius: 4, padding: '1px 4px',
          flexShrink: 0, colorScheme: 'dark',
        }}
      />
    )
  }

  // Nothing set and nothing to reveal: keep the row quiet until it is hovered.
  if (!iso && !hovered) return null

  const overdue = iso && task.status !== 'done' && new Date(iso) < new Date(new Date().toDateString())

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      title={t('taskEdit.setDueDate')}
      style={{
        fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
        background: 'none', border: 'none', padding: '2px 4px', borderRadius: 4,
        color: overdue ? DARK.danger : `rgba(var(--kt-ink-rgb), ${iso ? 0.3 : 0.18})`,
      }}
    >
      {iso
        ? new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })
        : '+ date'}
    </button>
  )
}

export default memo(function IssueRow({
  task, projectId, projectCode, onUpdate, onDelete,
  showProject, projectName, onCreateSubtask,
  allTasks = [], projectLabels = [], depth = 0,
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [showDeps, setShowDeps] = useState(false)
  const [showMembership, setShowMembership] = useState(false)
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [showAttachments, setShowAttachments] = useState(false)
  const [showBuildHistory, setShowBuildHistory] = useState(false)
  const [showWebhook, setShowWebhook] = useState(false)

  const { t } = useTranslation()
  const qc = useQueryClient()
  const regenMut = useMutation({
    mutationFn: () => regenerateToken(projectId, task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })
  const createIssueMut = useMutation({
    mutationFn: () => createExternalIssue(projectId, task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (e) => window.alert(e?.response?.data?.detail || 'Could not create external issue'),
  })

  const issueId = `${(projectCode || 'TSK')}-${task.id.slice(-4).toUpperCase()}`
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const labels = task.labels || []
  const subtaskCount = task.subtask_count || 0
  const subtasks = allTasks.filter(t => t.parent_id === task.id)

  const handleCreateSubtask = () => {
    if (!subtaskTitle.trim()) return
    onCreateSubtask && onCreateSubtask(task.id, subtaskTitle.trim())
    setSubtaskTitle('')
    setShowSubtaskForm(false)
    setExpanded(true)
  }

  if (editing) {
    return (
      <TaskEditForm
        task={task}
        depth={depth}
        projectId={projectId}
        projectLabels={projectLabels}
        onSave={onUpdate}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center',
          padding: `0 16px 0 ${16 + depth * 20}px`, height: 36, gap: 8,
          borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
          background: hovered ? DARK.hover : 'transparent',
          transition: 'background 0.12s',
        }}
      >
        {/* Expand/collapse for subtasks */}
        {subtaskCount > 0 || subtasks.length > 0 ? (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        <PriorityIcon priority={task.priority} />
        <StatusIcon status={task.status} />

        <span style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.22)', fontFamily: 'monospace', minWidth: 64, flexShrink: 0 }}>
          {issueId}
        </span>

        {/* Pin indicator */}
        {task.is_pinned && (
          <Pin size={11} style={{ color: DARK.warning, flexShrink: 0, transform: 'rotate(45deg)' }} />
        )}

        <span style={{
          flex: 1, fontSize: 13,
          color: task.status === 'done' ? 'rgba(var(--kt-ink-rgb), 0.25)' : DARK.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
          {task.description && !hovered && labels.length === 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }}
              title={t('taskEdit.toggleDescription')}
              style={{ ...BADGE_BUTTON, color: DARK.textMid, marginLeft: 6, fontSize: 11, fontWeight: 400, textAlign: 'left' }}
            >
              {task.description.length > 60 ? task.description.slice(0, 60) + '\u2026' : task.description}
            </button>
          )}
        </span>

        {/* Custom task-like type badge (ADR-0035) */}
        <TypeBadge type={task.type} />

        {/* Label chips */}
        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'nowrap', overflow: 'hidden', maxWidth: 160 }}>
            {labels.slice(0, 3).map(lb => <LabelChip key={lb.id} label={lb} />)}
          </div>
        )}

        {/* Pull request badges (click jumps to the external PR page) */}
        {(task.pull_requests || []).length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {task.pull_requests.slice(0, 2).map(pr => <PrBadge key={pr.id} pr={pr} />)}
          </div>
        )}

        {/* Subtask count badge */}
        {subtaskCount > 0 && (
          <span style={{
            fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.35)', background: 'rgba(var(--kt-ink-rgb), 0.06)',
            padding: '1px 6px', borderRadius: 10, flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {subtaskCount} {t('issue.subtask')}
          </span>
        )}

        {/* Multi-project membership badge (ADR-0032) */}
        {(task.project_ids || []).length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowMembership(v => !v) }}
            title={t('membership.badge', { count: task.project_ids.length })}
            style={{
              ...BADGE_BUTTON,
              color: showMembership ? '#818cf8' : 'rgba(129,140,248,0.75)',
              whiteSpace: 'nowrap',
            }}
          >
            <Boxes size={11} />{task.project_ids.length}
          </button>
        )}

        {/* Recurrence badge */}
        {task.recurrence && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowRecurrence(v => !v) }}
            title={t('recurrence.repeats', { frequency: task.recurrence.frequency })}
            style={{
              ...BADGE_BUTTON,
              color: showRecurrence ? DARK.success : 'rgba(var(--kt-ink-rgb), 0.3)',
            }}
          >
            <Repeat2 size={11} />
          </button>
        )}

        {/* Blocked badge */}
        {(task.blocked_by || []).length > 0 && (
          <span style={{
            fontSize: 10, color: DARK.warning, background: 'rgba(255,164,43,0.12)',
            border: '1px solid rgba(255,164,43,0.3)', padding: '1px 7px', borderRadius: 9999,
            flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 600,
          }}>
            {t('issue.blocked')}
          </span>
        )}

        {/* Comment count badge */}
        {(task.comment_count || 0) > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowComments(v => !v) }}
            title={t('issue.comments')}
            style={{
              ...BADGE_BUTTON,
              color: 'rgba(var(--kt-ink-rgb), 0.35)', whiteSpace: 'nowrap',
            }}
          >
            <MessageSquare size={10} />{task.comment_count}
          </button>
        )}

        {/* Agent badge */}
        {task.assigned_agent_name && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 7px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
            background: 'rgba(250,204,21,0.12)', color: DARK.info,
            border: '1px solid rgba(250,204,21,0.25)', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            <Bot size={9} />
            {task.assigned_agent_name}
          </span>
        )}

        {task.progress_pct != null && task.progress_pct >= 0 && (
          <span
            title={`Progress: ${task.progress_pct}%${task.agent_notes ? '\n' + task.agent_notes : ''}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.45)', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 36, height: 4, background: 'rgba(var(--kt-ink-rgb), 0.1)',
              borderRadius: 2, overflow: 'hidden', display: 'inline-block',
            }}>
              <span style={{
                display: 'block', height: '100%',
                width: `${task.progress_pct}%`,
                background: task.progress_pct >= 100 ? DARK.success : DARK.info,
                borderRadius: 2, transition: 'width 0.3s',
              }} />
            </span>
            {task.progress_pct}%
          </span>
        )}

        {showProject && projectName && (
          <span style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)', background: 'rgba(var(--kt-ink-rgb), 0.06)', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {projectName}
          </span>
        )}

        {/* Time tracking */}
        <TimeTracker task={task} onUpdate={onUpdate} />

        <DueDateCell task={task} hovered={hovered} onUpdate={onUpdate} />

        <span style={{
          fontSize: 11, color: p.color, background: p.bg,
          padding: '2px 7px', borderRadius: 4, fontWeight: 500, flexShrink: 0,
          border: `1px solid ${p.color}33`,
        }}>
          {p.label}
        </span>

        {hovered ? (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {task.description && (
              <button onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }} title="Toggle description" style={{ background: showDescription ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showDescription ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
                <FileText size={12} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setShowComments(v => !v) }} title="Comments"
              style={{ background: showComments ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showComments ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <MessageSquare size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowDeps(v => !v) }} title="Dependencies"
              style={{ background: showDeps ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showDeps ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <GitBranch size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowMembership(v => !v) }} title={t('membership.title')}
              style={{ background: showMembership ? 'rgba(129,140,248,0.14)' : 'none', border: 'none', cursor: 'pointer', color: showMembership ? '#818cf8' : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Boxes size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowRecurrence(v => !v) }} title="Recurrence"
              style={{ background: showRecurrence ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showRecurrence ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Repeat2 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowAttachments(v => !v) }} title="Attachments"
              style={{ background: showAttachments ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showAttachments ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Paperclip size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowBuildHistory(v => !v) }} title="Build History"
              style={{ background: showBuildHistory ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showBuildHistory ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Activity size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowWebhook(v => !v) }} title="Webhook setup"
              style={{ background: showWebhook ? 'rgba(250,204,21,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showWebhook ? DARK.success : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Link2 size={12} />
            </button>
            {task.external_url ? (
              <a
                href={task.external_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Open linked ${task.external_provider || 'external'} issue #${task.external_id}`}
                style={{ display: 'inline-flex', color: '#818cf8', padding: '2px 5px', borderRadius: 4 }}
              >
                <ExternalLink size={12} />
              </a>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); createIssueMut.mutate() }}
                disabled={createIssueMut.isPending}
                title="Create a linked issue in the project's repository"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: '2px 5px', borderRadius: 4 }}
              >
                <GitPullRequestArrow size={12} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm('Regenerate webhook token? Old URLs will stop working.')) regenMut.mutate() }}
              title="Regenerate webhook token"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: '2px 5px', borderRadius: 4 }}
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdate(task.id, { is_pinned: !task.is_pinned }) }}
              title={task.is_pinned ? t('issue.unpin') : t('issue.pin')}
              style={{ background: task.is_pinned ? 'rgba(255,164,43,0.12)' : 'none', border: 'none', cursor: 'pointer', color: task.is_pinned ? DARK.warning : DARK.textMid, padding: '2px 5px', borderRadius: 4 }}
            >
              <Pin size={12} style={{ transform: 'rotate(45deg)' }} />
            </button>
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: '2px 5px', borderRadius: 4 }}>
              <Pencil size={12} />
            </button>
            {onCreateSubtask && (
              <button
                onClick={() => { setShowSubtaskForm(v => !v); setExpanded(true) }}
                title="Add subtask"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: '2px 5px', borderRadius: 4 }}
              >
                <Plus size={12} />
              </button>
            )}
            <button onClick={() => { if (confirm(t('issue.deleteConfirm', { title: task.title }))) onDelete(task.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(250,204,21,0.7)', padding: '2px 5px', borderRadius: 4 }}>
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <div style={{ width: onCreateSubtask ? 130 : 108, flexShrink: 0 }} />
        )}
      </div>

      {/* Expanded description preview */}
      {showDescription && task.description && (
        <div style={{
          paddingLeft: 16 + depth * 20 + 36,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 10,
          borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
          background: 'rgba(var(--kt-ink-rgb), 0.02)',
          fontSize: 13,
          lineHeight: 1.6,
          color: DARK.textMid,
        }}>
          <MarkdownPreview content={task.description} />
        </div>
      )}

      {/* Comments panel */}
      {showComments && (
        <CommentsPanel projectId={projectId} taskId={task.id} depth={depth} />
      )}

      {/* Dependencies panel */}
      {showDeps && (
        <DependenciesPanel projectId={projectId} task={task} allTasks={allTasks} depth={depth} />
      )}

      {/* Cross-project membership panel */}
      {showMembership && (
        <MembershipPanel projectId={projectId} task={task} depth={depth} />
      )}

      {/* Recurrence panel */}
      {showRecurrence && (
        <RecurrencePanel projectId={projectId} task={task} depth={depth} />
      )}

      {/* Attachments panel */}
      {showAttachments && (
        <AttachmentsPanel projectId={projectId} taskId={task.id} depth={depth} />
      )}

      {/* Webhook setup panel: URL and signing key together, because one without the
          other configures nothing (ADR-0060). */}
      {showWebhook && (
        <div style={{
          paddingLeft: 16 + depth * 20 + 36, paddingRight: 16,
          paddingTop: 8, paddingBottom: 10,
          borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
          background: 'rgba(var(--kt-ink-rgb), 0.02)',
        }}>
          <WebhookPanel taskId={task.id} />
        </div>
      )}

      {/* Build history panel */}
      {showBuildHistory && (
        <div style={{
          paddingLeft: 16 + depth * 20 + 36, paddingRight: 16,
          paddingTop: 8, paddingBottom: 10,
          borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
          background: 'rgba(var(--kt-ink-rgb), 0.02)',
        }}>
          <BuildHistoryPanel taskId={task.id} />
        </div>
      )}

      {/* Inline subtask creation form */}
      {showSubtaskForm && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          padding: `6px 16px 6px ${16 + (depth + 1) * 20 + 12}px`,
          background: 'rgba(var(--kt-ink-rgb), 0.02)', borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
        }}>
          <input
            autoFocus
            value={subtaskTitle}
            onChange={e => setSubtaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateSubtask(); if (e.key === 'Escape') setShowSubtaskForm(false) }}
            placeholder={t('issue.subtaskTitlePlaceholder')}
            style={{ flex: 1, padding: '4px 10px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 5, fontSize: 12, outline: 'none', background: DARK.hover, color: DARK.text }}
          />
          <button onClick={handleCreateSubtask} style={{ padding: '4px 14px', border: 'none', borderRadius: 9999, background: DARK.success, color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('add')}</button>
          <button onClick={() => setShowSubtaskForm(false)} style={{ padding: '4px 12px', border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 9999, background: 'transparent', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: DARK.text, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('cancel')}</button>
        </div>
      )}

      {/* Subtasks (expanded) */}
      {expanded && subtasks.map(sub => (
        <IssueRow
          key={sub.id}
          task={sub}
          projectId={projectId}
          projectCode={projectCode}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCreateSubtask={onCreateSubtask}
          allTasks={allTasks}
          projectLabels={projectLabels}
          depth={depth + 1}
        />
      ))}
    </>
  )
})
