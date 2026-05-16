import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { INSET_SHADOW } from '../constants/theme'
import MarkdownEditor from './MarkdownEditor'
import { getApiKeys } from '../api/client'

const darkInput = {
  background: '#1f1f1f',
  border: 'none',
  boxShadow: INSET_SHADOW,
  borderRadius: 4, padding: '6px 10px', fontSize: 12,
  color: '#ffffff', outline: 'none',
}

export default function TaskEditForm({ task, depth, onSave, onCancel }) {
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
    <div style={{ paddingLeft: depth * 24, background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
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
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{'\u2192'}</span>
          <input type="date" value={editData.due_date} onChange={e => setEditData(p => ({ ...p, due_date: e.target.value }))}
            style={{ ...darkInput }} />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{t('taskEdit.estimated')}</span>
          <input type="number" min="0" placeholder="min" value={editData.time_estimate}
            onChange={e => setEditData(p => ({ ...p, time_estimate: e.target.value }))}
            style={{ ...darkInput, width: 70 }} />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{t('taskEdit.spent')}</span>
          <input type="number" min="0" placeholder="min" value={editData.time_spent}
            onChange={e => setEditData(p => ({ ...p, time_spent: e.target.value }))}
            style={{ ...darkInput, width: 70 }} />
          {activeKeys.length > 0 && (
            <select
              value={editData.assigned_agent_key_id}
              onChange={e => setEditData(p => ({ ...p, assigned_agent_key_id: e.target.value }))}
              style={{ ...darkInput, fontSize: 11, color: editData.assigned_agent_key_id ? '#818cf8' : '#b3b3b3' }}
            >
              <option value="">{t('agent.none')}</option>
              {activeKeys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <MarkdownEditor
            value={editData.description}
            onChange={(val) => setEditData(p => ({ ...p, description: val }))}
            placeholder={t('taskEdit.descriptionPlaceholder')}
            minHeight={80}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onCancel} style={{ padding: '5px 14px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, background: 'transparent', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px' }}>{t('cancel')}</button>
          <button onClick={handleSave} style={{ padding: '5px 16px', border: 'none', borderRadius: 9999, background: '#1ed760', color: '#000', fontSize: 12, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
