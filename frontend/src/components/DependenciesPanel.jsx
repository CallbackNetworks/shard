import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { addDependency, removeDependency } from '../api/client'
import { qk } from '../api/queryKeys'
import Button from './shared/Button'

export default function DependenciesPanel({ projectId, task, allTasks, depth }) {
  const { t } = useTranslation()
  const [depInput, setDepInput] = useState('')
  const qc = useQueryClient()

  const handleAdd = async () => {
    const targetId = depInput.trim()
    if (!targetId) return
    await addDependency(projectId, task.id, targetId)
    setDepInput('')
    qc.invalidateQueries({ queryKey: qk.project(projectId) })
  }

  const handleRemove = async (dependsOnId) => {
    await removeDependency(projectId, task.id, dependsOnId)
    qc.invalidateQueries({ queryKey: qk.project(projectId) })
  }

  const blockedBy = task.blocked_by || []
  const padLeft = 16 + depth * 20 + 36

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
      background: 'rgba(var(--kt-ink-rgb), 0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(var(--kt-ink-rgb), 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {t('deps.blockedBy')}
      </div>
      {blockedBy.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.2)', marginBottom: 8 }}>{t('deps.noBlockers')}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {blockedBy.map(depId => {
            const blocker = allTasks.find(t => t.id === depId)
            return (
              <span key={depId} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,164,43,0.1)', border: '1px solid rgba(255,164,43,0.2)', color: '#ffa42b' }}>
                {blocker ? blocker.title : depId.slice(-8)}
                <button onClick={() => handleRemove(depId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ffa42b', padding: 0, display: 'flex' }}>
                  <X size={9} />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={depInput}
          onChange={e => setDepInput(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 5, fontSize: 11, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: 'var(--kt-ink)', outline: 'none' }}
        >
          <option value="">{t('deps.pickBlocker')}</option>
          {allTasks.filter(t => t.id !== task.id && !blockedBy.includes(t.id)).map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <Button onClick={handleAdd} disabled={!depInput} tone="#ffa42b" ink="#171717">{t('deps.block')}</Button>
      </div>
    </div>
  )
}
