import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { setRecurrence, updateRecurrence, removeRecurrence } from '../api/client'

export default function RecurrencePanel({ projectId, task, depth }) {
  const { t } = useTranslation()
  const [recurForm, setRecurForm] = useState({
    frequency: 'weekly',
    interval_value: 1,
    next_run_at: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    active: true,
  })
  const qc = useQueryClient()

  const handleCreate = async () => {
    await setRecurrence(projectId, task.id, {
      ...recurForm,
      next_run_at: new Date(recurForm.next_run_at).toISOString(),
    })
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const padLeft = 16 + depth * 20 + 36
  const inputStyle = { padding: '4px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 11, background: 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {t('recurrence.title')}
      </div>
      {task.recurrence ? (
        <div style={{ fontSize: 12, color: '#b3b3b3' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ color: '#1ed760', fontWeight: 600 }}>
              {t('recurrence.repeats', { frequency: task.recurrence.frequency === 'interval'
                ? `every ${task.recurrence.interval_value} day(s)`
                : task.recurrence.frequency })}
            </span>
            <span style={{ color: task.recurrence.active ? '#1ed760' : '#b3b3b3', fontSize: 10 }}>
              {task.recurrence.active ? t('recurrence.active') : t('recurrence.paused')}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', marginBottom: 8, fontSize: 11 }}>
            {t('recurrence.nextRun')} {new Date(task.recurrence.next_run_at).toLocaleString()}
            {task.recurrence.last_run_at && (
              <> {'\u00B7'} {t('recurrence.lastRan')} {new Date(task.recurrence.last_run_at).toLocaleString()}</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={async () => {
                await updateRecurrence(projectId, task.id, { active: !task.recurrence.active })
                qc.invalidateQueries({ queryKey: ['project', projectId] })
              }}
              style={{ padding: '4px 14px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, background: 'transparent', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#1ed760', textTransform: 'uppercase', letterSpacing: '1px' }}
            >
              {task.recurrence.active ? t('pause') : t('resume')}
            </button>
            <button
              onClick={async () => {
                if (!confirm('Remove recurrence rule?')) return
                await removeRecurrence(projectId, task.id)
                qc.invalidateQueries({ queryKey: ['project', projectId] })
              }}
              style={{ padding: '4px 14px', border: '1px solid rgba(243,114,127,0.4)', borderRadius: 9999, background: 'transparent', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#f3727f', textTransform: 'uppercase', letterSpacing: '1px' }}
            >
              {t('remove')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select
              value={recurForm.frequency}
              onChange={e => setRecurForm(p => ({ ...p, frequency: e.target.value }))}
              style={inputStyle}
            >
              <option value="daily">{t('recurrence.daily')}</option>
              <option value="weekly">{t('recurrence.weekly')}</option>
              <option value="monthly">{t('recurrence.monthly')}</option>
              <option value="interval">{t('recurrence.everyNDays')}</option>
            </select>
            {recurForm.frequency === 'interval' && (
              <input
                type="number" min="1" max="365"
                value={recurForm.interval_value}
                onChange={e => setRecurForm(p => ({ ...p, interval_value: parseInt(e.target.value) || 1 }))}
                style={{ ...inputStyle, width: 70 }}
              />
            )}
            <input
              type="date"
              value={recurForm.next_run_at}
              onChange={e => setRecurForm(p => ({ ...p, next_run_at: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <button
            onClick={handleCreate}
            style={{ padding: '4px 16px', border: 'none', borderRadius: 9999, background: '#1ed760', color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}
          >
            {t('recurrence.setRecurrence')}
          </button>
        </div>
      )}
    </div>
  )
}
