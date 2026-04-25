import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { addDependency, removeDependency } from '../api/client'

export default function DependenciesPanel({ projectId, task, allTasks, depth }) {
  const [depInput, setDepInput] = useState('')
  const qc = useQueryClient()

  const handleAdd = async () => {
    const targetId = depInput.trim()
    if (!targetId) return
    await addDependency(projectId, task.id, targetId)
    setDepInput('')
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const handleRemove = async (dependsOnId) => {
    await removeDependency(projectId, task.id, dependsOnId)
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const blockedBy = task.blocked_by || []
  const padLeft = 16 + depth * 20 + 36

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Blocked by
      </div>
      {blockedBy.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginBottom: 8 }}>No blockers.</div>
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
          style={{ flex: 1, padding: '4px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 11, background: 'rgba(255,255,255,0.05)', color: '#ffffff', outline: 'none' }}
        >
          <option value="">{'\u2014'} pick a blocker task {'\u2014'}</option>
          {allTasks.filter(t => t.id !== task.id && !blockedBy.includes(t.id)).map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <button onClick={handleAdd} disabled={!depInput} style={{ padding: '4px 14px', border: 'none', borderRadius: 9999, background: '#ffa42b', color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, opacity: depInput ? 1 : 0.4, textTransform: 'uppercase', letterSpacing: '1px' }}>Block</button>
      </div>
    </div>
  )
}
