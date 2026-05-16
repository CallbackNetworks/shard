import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Pencil, Trash2, ChevronDown, ChevronRight, Plus, RefreshCw, FileText, MessageSquare, GitBranch, Repeat2, Paperclip, Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { regenerateToken } from '../api/client'
import { PRIORITY, STATUS_MAP } from '../constants/theme'
import { PriorityIcon, StatusIcon, LabelChip } from './TaskIcons'
import TaskEditForm from './TaskEditForm'
import CommentsPanel from './CommentsPanel'
import DependenciesPanel from './DependenciesPanel'
import RecurrencePanel from './RecurrencePanel'
import AttachmentsPanel from './AttachmentsPanel'
import MarkdownPreview from './MarkdownPreview'

export default function IssueRow({
  task, projectId, projectCode, onUpdate, onDelete,
  showProject, projectName, onCreateSubtask,
  allTasks = [], depth = 0,
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [showDeps, setShowDeps] = useState(false)
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [showAttachments, setShowAttachments] = useState(false)

  const { t } = useTranslation()
  const qc = useQueryClient()
  const regenMut = useMutation({
    mutationFn: () => regenerateToken(projectId, task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const issueId = `${(projectCode || 'TSK')}-${task.id.slice(-4).toUpperCase()}`
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const labels = task.labels || []
  const subtaskCount = task.subtask_count || 0
  const subtasks = allTasks.filter(t => t.parent_id === task.id)

  const copyWebhook = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(`${window.location.origin}/webhook/callback/${task.callback_token}`)
  }

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
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
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

        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', fontFamily: 'monospace', minWidth: 64, flexShrink: 0 }}>
          {issueId}
        </span>

        <span style={{
          flex: 1, fontSize: 13,
          color: task.status === 'done' ? 'rgba(255,255,255,0.25)' : '#ffffff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
          {task.description && !hovered && labels.length === 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }}
              style={{ color: '#b3b3b3', marginLeft: 6, fontSize: 11, fontWeight: 400, cursor: 'pointer' }}
            >
              {task.description.length > 60 ? task.description.slice(0, 60) + '\u2026' : task.description}
            </span>
          )}
        </span>

        {/* Label chips */}
        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'nowrap', overflow: 'hidden', maxWidth: 160 }}>
            {labels.slice(0, 3).map(lb => <LabelChip key={lb.id} label={lb} />)}
          </div>
        )}

        {/* Subtask count badge */}
        {subtaskCount > 0 && (
          <span style={{
            fontSize: 10, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.06)',
            padding: '1px 6px', borderRadius: 10, flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {subtaskCount} {t('issue.subtask')}
          </span>
        )}

        {/* Recurrence badge */}
        {task.recurrence && (
          <span
            onClick={(e) => { e.stopPropagation(); setShowRecurrence(v => !v) }}
            title={t('recurrence.repeats', { frequency: task.recurrence.frequency })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, color: showRecurrence ? '#1ed760' : 'rgba(255,255,255,0.3)',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Repeat2 size={11} />
          </span>
        )}

        {/* Blocked badge */}
        {(task.blocked_by || []).length > 0 && (
          <span style={{
            fontSize: 10, color: '#ffa42b', background: 'rgba(255,164,43,0.12)',
            border: '1px solid rgba(255,164,43,0.3)', padding: '1px 7px', borderRadius: 9999,
            flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 600,
          }}>
            {t('issue.blocked')}
          </span>
        )}

        {/* Comment count badge */}
        {(task.comment_count || 0) > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); setShowComments(v => !v) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            <MessageSquare size={10} />{task.comment_count}
          </span>
        )}

        {/* Agent badge */}
        {task.assigned_agent_name && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 7px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
            background: 'rgba(129,140,248,0.12)', color: '#818cf8',
            border: '1px solid rgba(129,140,248,0.25)', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            <Bot size={9} />
            {task.assigned_agent_name}
          </span>
        )}

        {showProject && projectName && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {projectName}
          </span>
        )}

        {task.due_date && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </span>
        )}

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
              <button onClick={(e) => { e.stopPropagation(); setShowDescription(v => !v) }} title="Toggle description" style={{ background: showDescription ? 'rgba(30,215,96,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showDescription ? '#1ed760' : '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
                <FileText size={12} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setShowComments(v => !v) }} title="Comments"
              style={{ background: showComments ? 'rgba(30,215,96,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showComments ? '#1ed760' : '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <MessageSquare size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowDeps(v => !v) }} title="Dependencies"
              style={{ background: showDeps ? 'rgba(30,215,96,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showDeps ? '#1ed760' : '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <GitBranch size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowRecurrence(v => !v) }} title="Recurrence"
              style={{ background: showRecurrence ? 'rgba(30,215,96,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showRecurrence ? '#1ed760' : '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <Repeat2 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowAttachments(v => !v) }} title="Attachments"
              style={{ background: showAttachments ? 'rgba(30,215,96,0.12)' : 'none', border: 'none', cursor: 'pointer', color: showAttachments ? '#1ed760' : '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <Paperclip size={12} />
            </button>
            <button onClick={copyWebhook} title="Copy webhook URL" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <Link2 size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm('Regenerate webhook token? Old URLs will stop working.')) regenMut.mutate() }}
              title="Regenerate webhook token"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}
            >
              <RefreshCw size={12} />
            </button>
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}>
              <Pencil size={12} />
            </button>
            {onCreateSubtask && (
              <button
                onClick={() => { setShowSubtaskForm(v => !v); setExpanded(true) }}
                title="Add subtask"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3b3b3', padding: '2px 5px', borderRadius: 4 }}
              >
                <Plus size={12} />
              </button>
            )}
            <button onClick={() => { if (confirm(t('issue.deleteConfirm', { title: task.title }))) onDelete(task.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(243,114,127,0.7)', padding: '2px 5px', borderRadius: 4 }}>
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
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.02)',
          fontSize: 13,
          lineHeight: 1.6,
          color: '#b3b3b3',
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

      {/* Recurrence panel */}
      {showRecurrence && (
        <RecurrencePanel projectId={projectId} task={task} depth={depth} />
      )}

      {/* Attachments panel */}
      {showAttachments && (
        <AttachmentsPanel projectId={projectId} taskId={task.id} depth={depth} />
      )}

      {/* Inline subtask creation form */}
      {showSubtaskForm && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          padding: `6px 16px 6px ${16 + (depth + 1) * 20 + 12}px`,
          background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <input
            autoFocus
            value={subtaskTitle}
            onChange={e => setSubtaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateSubtask(); if (e.key === 'Escape') setShowSubtaskForm(false) }}
            placeholder={t('issue.subtaskTitlePlaceholder')}
            style={{ flex: 1, padding: '4px 10px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 12, outline: 'none', background: 'rgba(255,255,255,0.05)', color: '#ffffff' }}
          />
          <button onClick={handleCreateSubtask} style={{ padding: '4px 14px', border: 'none', borderRadius: 9999, background: '#1ed760', color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('add')}</button>
          <button onClick={() => setShowSubtaskForm(false)} style={{ padding: '4px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, background: 'transparent', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px' }}>{t('cancel')}</button>
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
          depth={depth + 1}
        />
      ))}
    </>
  )
}
