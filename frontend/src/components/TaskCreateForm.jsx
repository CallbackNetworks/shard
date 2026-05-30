import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getTemplates, getApiKeys } from '../api/client'
import { BRAND, INSET_SHADOW, DARK } from '../constants/theme'
import MarkdownEditor from './MarkdownEditor'

const input = {
  background: DARK.elevated, border: 'none', borderRadius: 4,
  padding: '7px 10px', fontSize: 13, outline: 'none', color: DARK.text,
  boxShadow: INSET_SHADOW,
}

export default function TaskCreateForm({ showForm, newTask, setNewTask, createMut, labels, onCancel, projectId }) {
  const { t } = useTranslation()
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => getTemplates(projectId),
    enabled: showForm,
  })
  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys, enabled: showForm })
  const activeKeys = apiKeys.filter(k => k.active)

  const applyTemplate = (tplId) => {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    setNewTask(p => ({
      ...p,
      title: tpl.name,
      description: tpl.description || '',
      priority: tpl.priority,
    }))
  }

  if (!showForm) return null

  return (
    <div style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${DARK.border}` }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {templates.length > 0 && (
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }}
            style={{ ...input, fontSize: 11, color: DARK.textMid }}
          >
            <option value="" disabled>{t('taskCreate.templatePlaceholder')}</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <input
          autoFocus
          value={newTask.title}
          onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
          placeholder={t('taskCreate.issueTitlePlaceholder')}
          onKeyDown={e => e.key === 'Enter' && newTask.title && createMut.mutate(newTask)}
          style={{ ...input, flex: '1 1 200px' }}
        />
        <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
          style={{ ...input }}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          value={newTask.assignee}
          onChange={e => setNewTask(p => ({ ...p, assignee: e.target.value }))}
          placeholder="Assignee"
          style={{ ...input, width: 100 }}
        />
        {activeKeys.length > 0 && (
          <select
            value={newTask.assigned_agent_key_id || ''}
            onChange={e => setNewTask(p => ({ ...p, assigned_agent_key_id: e.target.value || null }))}
            style={{ ...input, fontSize: 11, color: newTask.assigned_agent_key_id ? DARK.info : DARK.textMid }}
          >
            <option value="">{t('agent.none')}</option>
            {activeKeys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        <input type="date" value={newTask.start_date} onChange={e => setNewTask(p => ({ ...p, start_date: e.target.value }))}
          style={{ ...input }} />
        <span style={{ color: DARK.textMid, fontSize: 12 }}>→</span>
        <input type="date" value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))}
          style={{ ...input }} />
        <button onClick={onCancel}
          style={{ padding: '7px 16px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, background: 'transparent', color: DARK.text, fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {t('cancel')}
        </button>
        <button
          disabled={!newTask.title || createMut.isPending}
          onClick={() => createMut.mutate(newTask)}
          style={{
            padding: '7px 18px', border: 'none', borderRadius: 9999,
            background: BRAND, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            opacity: !newTask.title ? 0.5 : 1, textTransform: 'uppercase', letterSpacing: '1.4px',
          }}
        >
          {createMut.isPending ? t('creating') : t('create')}
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <MarkdownEditor
          value={newTask.description}
          onChange={(val) => setNewTask(p => ({ ...p, description: val }))}
          placeholder="Description (optional, supports Markdown)"
          minHeight={80}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: DARK.textMid }}>Labels:</span>
            {labels.map(lb => {
              const selected = newTask.selectedLabels.includes(lb.id)
              return (
                <button
                  key={lb.id}
                  onClick={() => setNewTask(p => ({
                    ...p,
                    selectedLabels: selected
                      ? p.selectedLabels.filter(x => x !== lb.id)
                      : [...p.selectedLabels, lb.id],
                  }))}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 9999, fontWeight: 600, cursor: 'pointer',
                    background: selected ? lb.color + '22' : 'transparent',
                    color: selected ? lb.color : DARK.textMid,
                    border: selected ? `1px solid ${lb.color}44` : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {lb.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
