import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, BarChart3, Copy, GitCompareArrows } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DARK, BRAND, STATUS_MAP } from '../constants/theme'
import {
  duplicateCycle, compareCycles, getCycleBurndown,
  createCycle, updateCycle, deleteCycle, addTaskToCycle, removeTaskFromCycle,
} from '../api/client'
import { qk } from '../api/queryKeys'

function BurndownChart({ cycleId }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  // Through the client, not a bare axios call: the internal API lives under `/api`
  // (ADR-0036), and a root-level request is answered by the SPA's own index.html — a
  // 200 full of HTML, which this chart then tried to plot.
  useEffect(() => {
    if (!cycleId) return
    getCycleBurndown(cycleId)
      .then(rows => setData(Array.isArray(rows) ? rows : []))
      .catch(() => setData([]))
  }, [cycleId])

  if (!data) return <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.25)', padding: '12px 0' }}>{t('cycle.loadingChart')}</div>
  if (data.length === 0) return <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.25)', padding: '12px 0' }}>{t('cycle.noBurndownData')}</div>

  const W = 320, H = 120, PX = 30, PY = 10
  const maxVal = Math.max(...data.map(d => d.total), 1)
  const toX = i => PX + (i / Math.max(data.length - 1, 1)) * (W - PX - 10)
  const toY = v => PY + (1 - v / maxVal) * (H - PY - 20)

  const remainingLine = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.remaining).toFixed(1)}`).join(' ')
  const idealLine = data.filter(d => d.ideal != null).map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.ideal).toFixed(1)}`).join(' ')

  const labelEvery = Math.max(1, Math.floor(data.length / 5))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }}>
      {/* Y axis labels */}
      <text x={PX - 4} y={toY(maxVal) + 3} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.25)" fontSize="8">{maxVal}</text>
      <text x={PX - 4} y={toY(0) + 3} textAnchor="end" fill="rgba(var(--kt-ink-rgb), 0.25)" fontSize="8">0</text>
      {/* Grid lines */}
      <line x1={PX} y1={toY(maxVal)} x2={W - 10} y2={toY(maxVal)} stroke="rgba(var(--kt-ink-rgb), 0.06)" />
      <line x1={PX} y1={toY(0)} x2={W - 10} y2={toY(0)} stroke="rgba(var(--kt-ink-rgb), 0.06)" />
      {/* Ideal line */}
      {idealLine && <path d={idealLine} fill="none" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth="1" strokeDasharray="4 3" />}
      {/* Remaining line */}
      <path d={remainingLine} fill="none" stroke={BRAND} strokeWidth="1.5" />
      {/* Dots on remaining */}
      {data.map((d, i) => (
        <circle key={i} cx={toX(i)} cy={toY(d.remaining)} r="2" fill={BRAND} />
      ))}
      {/* X axis date labels */}
      {data.map((d, i) => i % labelEvery === 0 || i === data.length - 1 ? (
        <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fill="rgba(var(--kt-ink-rgb), 0.25)" fontSize="7">
          {d.date.slice(5)}
        </text>
      ) : null)}
    </svg>
  )
}

function CompareView({ data }) {
  if (!data) return null
  const { cycle_a: a, cycle_b: b } = data
  const row = (label, va, vb, fmt) => {
    const fa = fmt ? fmt(va) : va
    const fb = fmt ? fmt(vb) : vb
    return (
      <div key={label} style={{ display: 'flex', gap: 4, fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.04)' }}>
        <span style={{ flex: 1, color: 'rgba(var(--kt-ink-rgb), 0.4)', textAlign: 'right', paddingRight: 8 }}>{label}</span>
        <span style={{ width: 80, textAlign: 'center', color: 'var(--kt-ink)', fontWeight: 600 }}>{fa}</span>
        <span style={{ width: 80, textAlign: 'center', color: 'var(--kt-ink)', fontWeight: 600 }}>{fb}</span>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', gap: 4, fontSize: 10, marginBottom: 6, color: 'rgba(var(--kt-ink-rgb), 0.3)' }}>
        <span style={{ flex: 1 }} />
        <span style={{ width: 80, textAlign: 'center', fontWeight: 700 }}>{a.name}</span>
        <span style={{ width: 80, textAlign: 'center', fontWeight: 700 }}>{b.name}</span>
      </div>
      {row('Total tasks', a.total_tasks, b.total_tasks)}
      {row('Completed', a.done, b.done)}
      {row('Rate', a.completion_rate, b.completion_rate, v => `${v}%`)}
      {row('Duration', a.duration_days, b.duration_days, v => v != null ? `${v}d` : '—')}
      {row('Est. (min)', a.total_estimate_min, b.total_estimate_min)}
      {row('Spent (min)', a.total_spent_min, b.total_spent_min)}
    </div>
  )
}

function CycleCard({ cycle, tasks, onUpdate, onDelete, onAddTask, onRemoveTask, onDuplicate, allCycles, projectId }) {
  const { t } = useTranslation()
  const [showTaskPicker, setShowTaskPicker] = useState(false)
  const [showBurndown, setShowBurndown] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [compareTarget, setCompareTarget] = useState('')
  const [compareData, setCompareData] = useState(null)
  const [duplicating, setDuplicating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({
    name: cycle.name,
    description: cycle.description || '',
    status: cycle.status,
    start_date: cycle.start_date ? cycle.start_date.split('T')[0] : '',
    end_date: cycle.end_date ? cycle.end_date.split('T')[0] : '',
  })

  const cycleTasks = tasks.filter(t => cycle.task_ids.includes(t.id))
  const availableTasks = tasks.filter(t => !cycle.task_ids.includes(t.id))
  const progress = cycle.total_tasks > 0 ? Math.round(cycle.done_tasks / cycle.total_tasks * 100) : 0

  const statusColors = { draft: '#94a3b8', active: '#facc15', completed: '#5e6ad2' }
  const sColor = statusColors[cycle.status] || '#94a3b8'

  const saveEdit = () => {
    const data = { ...editData }
    if (!data.start_date) delete data.start_date
    else data.start_date = new Date(data.start_date).toISOString()
    if (!data.end_date) delete data.end_date
    else data.end_date = new Date(data.end_date).toISOString()
    if (!data.description) delete data.description
    onUpdate(cycle.id, data)
    setEditing(false)
  }

  return (
    <div style={{
      border: cycle.status === 'active' ? `2px solid ${BRAND}` : '1px solid rgba(var(--kt-ink-rgb), 0.08)',
      borderRadius: 10, padding: 16, background: 'rgba(var(--kt-ink-rgb), 0.03)',
      boxShadow: cycle.status === 'active' ? '0 0 0 4px rgba(250,204,21,0.1)' : 'none',
    }}>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
              style={{ flex: '1 1 180px', padding: '6px 10px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 13, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text }} />
            <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }}>
              <option value="draft">{t('cycle.draft')}</option>
              <option value="active">{t('active')}</option>
              <option value="completed">{t('cycle.completed')}</option>
            </select>
            <input type="date" value={editData.start_date} onChange={e => setEditData(p => ({ ...p, start_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }} />
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.25)', alignSelf: 'center' }}>→</span>
            <input type="date" value={editData.end_date} onChange={e => setEditData(p => ({ ...p, end_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }} />
          </div>
          <input value={editData.description} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))}
            placeholder={t('cycle.descriptionPlaceholder')}
            style={{ padding: '6px 10px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveEdit} className="btn-sm" style={{ background: BRAND, color: 'var(--kt-bg)', border: 'none', fontWeight: 700 }}>{t('save')}</button>
            <button onClick={() => setEditing(false)} className="btn-sm">{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: DARK.text }}>{cycle.name}</span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                  background: sColor + '22', color: sColor, border: `1px solid ${sColor}44`,
                }}>
                  {cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
                </span>
              </div>
              {cycle.description && <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.35)' }}>{cycle.description}</p>}
              {(cycle.start_date || cycle.end_date) && (
                <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.25)', marginTop: 3 }}>
                  {cycle.start_date && new Date(cycle.start_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  {cycle.start_date && cycle.end_date && ' → '}
                  {cycle.end_date && new Date(cycle.end_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setEditing(true)} title={t('edit')} style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.4)', padding: '4px 10px', fontSize: 11 }}>{t('edit')}</button>
              <button
                disabled={duplicating}
                onClick={async () => {
                  setDuplicating(true)
                  try { await onDuplicate(cycle.id) } finally { setDuplicating(false) }
                }}
                title={t('cycle.duplicateAsTemplate')}
                style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.4)', padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center' }}
              >
                <Copy size={11} />
              </button>
              <button onClick={() => { if (confirm(t('cycle.deleteConfirm', { name: cycle.name }))) onDelete(cycle.id) }}
                style={{ background: 'none', border: '1px solid rgba(250,204,21,0.4)', borderRadius: 6, cursor: 'pointer', color: '#facc15', padding: '4px 10px', fontSize: 11 }}>
                {t('delete')}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.35)', marginBottom: 4 }}>
              <span>{t('cycle.doneCount', { done: cycle.done_tasks, total: cycle.total_tasks })}</span>
              <span>{progress}%</span>
            </div>
            <div style={{ height: 5, background: 'rgba(var(--kt-ink-rgb), 0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: BRAND, borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
          </div>

          {/* Burndown & Compare toggles */}
          {cycle.total_tasks > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowBurndown(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: showBurndown ? BRAND : 'rgba(var(--kt-ink-rgb), 0.35)',
                  background: showBurndown ? 'rgba(250,204,21,0.1)' : 'none',
                  border: '1px solid rgba(var(--kt-ink-rgb), 0.08)', borderRadius: 6,
                  padding: '3px 10px', cursor: 'pointer', fontWeight: 500,
                }}
              >
                <BarChart3 size={11} /> {t('cycle.burndown')}
              </button>
              {allCycles.length > 1 && (
                <button
                  onClick={() => { setShowCompare(v => !v); setCompareData(null) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 11, color: showCompare ? DARK.info : 'rgba(var(--kt-ink-rgb), 0.35)',
                    background: showCompare ? 'rgba(83,157,245,0.1)' : 'none',
                    border: '1px solid rgba(var(--kt-ink-rgb), 0.08)', borderRadius: 6,
                    padding: '3px 10px', cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  <GitCompareArrows size={11} /> {t('cycle.compare')}
                </button>
              )}
            </div>
          )}
          {showBurndown && cycle.total_tasks > 0 && (
            <div style={{ marginBottom: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 8px' }}>
              <BurndownChart cycleId={cycle.id} />
            </div>
          )}
          {showCompare && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={compareTarget}
                  onChange={e => { setCompareTarget(e.target.value); setCompareData(null) }}
                  style={{ padding: '4px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 11, background: DARK.surface, color: '#fff' }}
                >
                  <option value="">{t('cycle.selectCycle')}</option>
                  {allCycles.filter(c => c.id !== cycle.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  disabled={!compareTarget}
                  onClick={async () => {
                    try {
                      const data = await compareCycles(projectId, cycle.id, compareTarget)
                      setCompareData(data)
                    } catch { /* ignore */ }
                  }}
                  style={{
                    padding: '4px 12px', border: 'none', borderRadius: 6,
                    background: compareTarget ? DARK.info : 'rgba(var(--kt-ink-rgb), 0.06)',
                    color: compareTarget ? '#000' : 'rgba(var(--kt-ink-rgb), 0.3)',
                    fontSize: 11, fontWeight: 600, cursor: compareTarget ? 'pointer' : 'default',
                  }}
                >
                  {t('cycle.compare')}
                </button>
              </div>
              <CompareView data={compareData} />
            </div>
          )}

          {cycleTasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {cycleTasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(var(--kt-ink-rgb), 0.04)', borderRadius: 6 }}>
                  <span style={{ fontSize: 11, color: STATUS_MAP[t.status]?.color || '#94a3b8', fontWeight: 500, minWidth: 70 }}>
                    {STATUS_MAP[t.status]?.label || t.status}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: DARK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <button onClick={() => onRemoveTask(cycle.id, t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.25)', padding: '1px 3px' }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowTaskPicker(v => !v)}
            style={{ fontSize: 11, color: BRAND, background: 'rgba(250,204,21,0.1)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 500 }}
          >
            <Plus size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            {t('cycle.addIssues')}
          </button>
          {showTaskPicker && (
            <div style={{ marginTop: 8, border: '1px solid rgba(var(--kt-ink-rgb), 0.08)', borderRadius: 8, background: DARK.surface, maxHeight: 180, overflowY: 'auto' }}>
              {availableTasks.length === 0
                ? <div style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.25)' }}>{t('cycle.allIssuesInCycle')}</div>
                : availableTasks.map(t => (
                  <button key={t.id} onClick={() => { onAddTask(cycle.id, t.id); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.05)', fontSize: 12, color: DARK.text, cursor: 'pointer' }}>
                    {t.title}
                  </button>
                ))
              }
            </div>
          )}
        </>
      )}
    </div>
  )
}

const EMPTY_CYCLE = { name: '', description: '', status: 'draft', start_date: '', end_date: '' }

/**
 * A cycle is only ever created, edited or filled from this panel, so its writes
 * live here rather than being handed down from the project page. They used to be
 * five mutations and two pieces of form state declared in `ProjectDetail`, passed
 * back down as thirteen props — a component that already called the API itself for
 * duplicate, compare and burndown, and only for these five asked its parent to.
 */
export default function CyclePanel({ cycles, tasks, projectId }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showCycleForm, setShowCycleForm] = useState(false)
  const [newCycle, setNewCycle] = useState(EMPTY_CYCLE)

  // Cycles arrive inside the project payload, and the project list shows cycle
  // counts, so both are stale after any of these — the same pair the project page
  // invalidates on every other write.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.project(projectId) })
    qc.invalidateQueries({ queryKey: qk.projects() })
  }

  const createCycleMut = useMutation({
    mutationFn: (data) => createCycle(projectId, data),
    onSuccess: () => { invalidate(); setShowCycleForm(false); setNewCycle(EMPTY_CYCLE) },
  })

  const updateCycleMut = useMutation({
    mutationFn: ({ cycleId, data }) => updateCycle(projectId, cycleId, data),
    onSuccess: invalidate,
  })

  const deleteCycleMut = useMutation({
    mutationFn: (cycleId) => deleteCycle(projectId, cycleId),
    onSuccess: invalidate,
  })

  const addTaskToCycleMut = useMutation({
    mutationFn: ({ cycleId, taskId }) => addTaskToCycle(projectId, cycleId, taskId),
    onSuccess: invalidate,
  })

  const removeTaskFromCycleMut = useMutation({
    mutationFn: ({ cycleId, taskId }) => removeTaskFromCycle(projectId, cycleId, taskId),
    onSuccess: invalidate,
  })

  const handleDuplicate = async (cycleId) => {
    await duplicateCycle(projectId, cycleId)
    invalidate()
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: DARK.text }}>
          {t('cycle.title')}
        </h2>
        <button
          onClick={() => setShowCycleForm(v => !v)}
          className="btn-sm"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: BRAND, color: 'var(--kt-bg)', border: 'none', fontWeight: 700,
          }}
        >
          {t('cycle.new')}
        </button>
      </div>

      {showCycleForm && (
        <div style={{ background: 'rgba(var(--kt-ink-rgb), 0.03)', border: '1px solid rgba(var(--kt-ink-rgb), 0.08)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              autoFocus
              value={newCycle.name}
              onChange={e => setNewCycle(p => ({ ...p, name: e.target.value }))}
              placeholder={t('cycle.namePlaceholder')}
              style={{ flex: '1 1 180px', padding: '6px 10px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 13, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text }}
            />
            <select value={newCycle.status} onChange={e => setNewCycle(p => ({ ...p, status: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }}>
              <option value="draft">{t('cycle.draft')}</option>
              <option value="active">{t('active')}</option>
              <option value="completed">{t('cycle.completed')}</option>
            </select>
            <input type="date" value={newCycle.start_date} onChange={e => setNewCycle(p => ({ ...p, start_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }} />
            <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.25)', fontSize: 12 }}>→</span>
            <input type="date" value={newCycle.end_date} onChange={e => setNewCycle(p => ({ ...p, end_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: DARK.surface, color: DARK.text }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newCycle.description}
              onChange={e => setNewCycle(p => ({ ...p, description: e.target.value }))}
              placeholder={t('cycle.descriptionPlaceholder')}
              style={{ flex: 1, padding: '6px 10px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, fontSize: 12, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text }}
            />
            <button onClick={() => setShowCycleForm(false)}
              style={{ padding: '6px 12px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 6, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text, fontSize: 12, cursor: 'pointer' }}>
              {t('cancel')}
            </button>
            <button
              disabled={!newCycle.name || createCycleMut.isPending}
              onClick={() => {
                const data = { ...newCycle }
                if (!data.start_date) delete data.start_date
                else data.start_date = new Date(data.start_date).toISOString()
                if (!data.end_date) delete data.end_date
                else data.end_date = new Date(data.end_date).toISOString()
                if (!data.description) delete data.description
                createCycleMut.mutate(data)
              }}
              className="btn-sm"
              style={{
                background: BRAND, color: 'var(--kt-bg)', border: 'none', fontWeight: 700,
                opacity: !newCycle.name ? 0.5 : 1,
              }}
            >
              {createCycleMut.isPending ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      )}

      {cycles.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'rgba(var(--kt-ink-rgb), 0.25)', fontSize: 13 }}>
          {t('cycle.noCyclesYet')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {cycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              tasks={tasks}
              onUpdate={(cycleId, data) => updateCycleMut.mutate({ cycleId, data })}
              onDelete={(cycleId) => deleteCycleMut.mutate(cycleId)}
              onAddTask={(cycleId, taskId) => addTaskToCycleMut.mutate({ cycleId, taskId })}
              onRemoveTask={(cycleId, taskId) => removeTaskFromCycleMut.mutate({ cycleId, taskId })}
              onDuplicate={handleDuplicate}
              allCycles={cycles}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
