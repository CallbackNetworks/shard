import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { DARK, FORM_INPUT } from '../constants/theme'
import MarkdownEditor from './MarkdownEditor'
import { LabelChip } from './project/LabelManager'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import { getApiKeys, getEstimateSuggestion, addLabelToTask, removeLabelFromTask } from '../api/client'

const darkInput = FORM_INPUT

export default function TaskEditForm({ task, depth, projectId, projectLabels = [], onSave, onCancel }) {
  const { t } = useTranslation()
  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys })
  const activeKeys = apiKeys.filter(k => k.active)

  const [editData, setEditData] = useState({
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    status: task.status,
    start_date: task.start_date ? task.start_date.split('T')[0] : '',
    due_date: task.due_date ? task.due_date.split('T')[0] : '',
    time_estimate: task.time_estimate || '',
    time_spent: task.time_spent || '',
    assigned_agent_key_id: task.assigned_agent_key_id || '',
  })

  const suggestMut = useMutation({
    mutationFn: () => getEstimateSuggestion(parseInt(editData.time_estimate), task.project_id),
  })
  const suggestion = suggestMut.data

  // Labels are edges, not columns on the task, so they are applied immediately
  // rather than collected into the Save payload. Before this the UI could only
  // attach a label while creating a task and had no way at all to take one off.
  const taskLabels = task.labels || []
  const taskLabelIds = new Set(taskLabels.map(lb => lb.id))
  const unusedLabels = projectLabels.filter(lb => !taskLabelIds.has(lb.id))
  const invalidateProject = [['project', projectId]]
  const addLabelMut = useInvalidatingMutation({
    mutationFn: (labelId) => addLabelToTask(projectId, task.id, labelId),
    invalidateKeys: invalidateProject,
  })
  const removeLabelMut = useInvalidatingMutation({
    mutationFn: (labelId) => removeLabelFromTask(projectId, task.id, labelId),
    invalidateKeys: invalidateProject,
  })

  const handleSave = () => {
    const data = { ...editData }
    if (!data.start_date) delete data.start_date
    else data.start_date = new Date(data.start_date).toISOString()
    if (!data.due_date) delete data.due_date
    else data.due_date = new Date(data.due_date).toISOString()
    if (!data.description) delete data.description
    data.time_estimate = data.time_estimate ? parseInt(data.time_estimate) : null
    data.time_spent = data.time_spent ? parseInt(data.time_spent) : null
    // empty string means "unassign" — send null
    if (data.assigned_agent_key_id === '') data.assigned_agent_key_id = null
    onSave(task.id, data)
    onCancel()
  }

  return (
    <div style={{ paddingLeft: depth * 24, background: 'rgba(var(--kt-ink-rgb), 0.03)', borderBottom: `1px solid ${DARK.border}` }}>
      <div style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            autoFocus
            value={editData.title}
            onChange={e => setEditData(p => ({ ...p, title: e.target.value }))}
            placeholder={t('taskEdit.issueTitlePlaceholder')}
            style={{ ...darkInput, flex: '1 1 200px', fontSize: 13 }}
          />
          <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
            style={{ ...darkInput }}>
            <option value="todo">{t('todo')}</option>
            <option value="in_progress">{t('inProgress')}</option>
            <option value="done">{t('done')}</option>
            <option value="failed">{t('failed')}</option>
          </select>
          <select value={editData.priority} onChange={e => setEditData(p => ({ ...p, priority: e.target.value }))}
            style={{ ...darkInput }}>
            <option value="high">{t('high')}</option>
            <option value="medium">{t('medium')}</option>
            <option value="low">{t('low')}</option>
          </select>
          <input type="date" value={editData.start_date} onChange={e => setEditData(p => ({ ...p, start_date: e.target.value }))}
            style={{ ...darkInput }} />
          <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontSize: 12 }}>{'\u2192'}</span>
          <input type="date" value={editData.due_date} onChange={e => setEditData(p => ({ ...p, due_date: e.target.value }))}
            style={{ ...darkInput }} />
          <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontSize: 11 }}>{t('taskEdit.estimated')}</span>
          <input type="number" min="0" placeholder="min" value={editData.time_estimate}
            onChange={e => { setEditData(p => ({ ...p, time_estimate: e.target.value })); suggestMut.reset() }}
            style={{ ...darkInput, width: 70 }} />
          {parseInt(editData.time_estimate) > 0 && (
            <button
              type="button"
              onClick={() => suggestMut.mutate()}
              disabled={suggestMut.isPending}
              title={t('taskEdit.suggestEstimate')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.info, padding: 2, display: 'inline-flex' }}
            >
              <Sparkles size={13} />
            </button>
          )}
          {suggestion && (
            suggestion.suggested_estimate ? (
              <button
                type="button"
                onClick={() => setEditData(p => ({ ...p, time_estimate: String(suggestion.suggested_estimate) }))}
                title={t('taskEdit.applySuggestion')}
                style={{ background: 'rgba(129,140,248,0.12)', border: `1px solid ${DARK.info}`, borderRadius: 6, cursor: 'pointer', color: DARK.info, fontSize: 11, padding: '2px 7px' }}
              >
                {t('taskEdit.suggestHint', { minutes: suggestion.suggested_estimate, ratio: suggestion.ratio, n: suggestion.sample_size })}
              </button>
            ) : (
              <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.35)', fontSize: 11 }}>{t('taskEdit.noSuggestion')}</span>
            )
          )}
          <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontSize: 11 }}>{t('taskEdit.spent')}</span>
          <input type="number" min="0" placeholder="min" value={editData.time_spent}
            onChange={e => setEditData(p => ({ ...p, time_spent: e.target.value }))}
            style={{ ...darkInput, width: 70 }} />
          {activeKeys.length > 0 && (
            <select
              value={editData.assigned_agent_key_id}
              onChange={e => setEditData(p => ({ ...p, assigned_agent_key_id: e.target.value }))}
              style={{ ...darkInput, fontSize: 11, color: editData.assigned_agent_key_id ? DARK.info : DARK.textMid }}
            >
              <option value="">{t('agent.none')}</option>
              {activeKeys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          )}
        </div>
        {projectId && (projectLabels.length > 0 || taskLabels.length > 0) && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontSize: 11 }}>{t('taskEdit.labels')}</span>
            {taskLabels.map(lb => (
              <LabelChip key={lb.id} label={lb} onRemove={() => removeLabelMut.mutate(lb.id)} />
            ))}
            {unusedLabels.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) addLabelMut.mutate(e.target.value) }}
                aria-label={t('taskEdit.addLabel')}
                style={{ ...darkInput, fontSize: 11 }}
              >
                <option value="">{t('taskEdit.addLabel')}</option>
                {unusedLabels.map(lb => <option key={lb.id} value={lb.id}>{lb.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <MarkdownEditor
            value={editData.description}
            onChange={(val) => setEditData(p => ({ ...p, description: val }))}
            placeholder={t('taskEdit.descriptionPlaceholder')}
            minHeight={80}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onCancel} style={{ padding: '5px 14px', border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 9999, background: 'transparent', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: DARK.text, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('cancel')}</button>
          <button onClick={handleSave} style={{ padding: '5px 16px', border: 'none', borderRadius: 9999, background: DARK.success, color: '#000', fontSize: 12, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
