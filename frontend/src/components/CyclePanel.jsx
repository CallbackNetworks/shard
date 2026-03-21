import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { BRAND, STATUS_MAP } from '../constants/theme'

function CycleCard({ cycle, tasks, onUpdate, onDelete, onAddTask, onRemoveTask }) {
  const [showTaskPicker, setShowTaskPicker] = useState(false)
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

  const statusColors = { draft: '#94a3b8', active: '#22c55e', completed: '#5e6ad2' }
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
      border: cycle.status === 'active' ? `2px solid ${BRAND}` : '1px solid #e5e7eb',
      borderRadius: 10, padding: 16, background: '#fff',
      boxShadow: cycle.status === 'active' ? '0 0 0 4px #5e6ad222' : 'none',
    }}>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
              style={{ flex: '1 1 180px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
            <input type="date" value={editData.start_date} onChange={e => setEditData(p => ({ ...p, start_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            <span style={{ color: '#9ca3af', alignSelf: 'center' }}>→</span>
            <input type="date" value={editData.end_date} onChange={e => setEditData(p => ({ ...p, end_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>
          <input value={editData.description} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))}
            placeholder="Description (optional)"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveEdit} style={{ padding: '5px 12px', border: 'none', borderRadius: 6, background: BRAND, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{cycle.name}</span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                  background: sColor + '22', color: sColor, border: `1px solid ${sColor}44`,
                }}>
                  {cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
                </span>
              </div>
              {cycle.description && <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{cycle.description}</p>}
              {(cycle.start_date || cycle.end_date) && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                  {cycle.start_date && new Date(cycle.start_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  {cycle.start_date && cycle.end_date && ' → '}
                  {cycle.end_date && new Date(cycle.end_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setEditing(true)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', color: '#6b7280', padding: '4px 10px', fontSize: 11 }}>Edit</button>
              <button onClick={() => { if (confirm(`Delete cycle "${cycle.name}"?`)) onDelete(cycle.id) }}
                style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', color: '#ef4444', padding: '4px 10px', fontSize: 11 }}>
                Delete
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
              <span>{cycle.done_tasks}/{cycle.total_tasks} done</span>
              <span>{progress}%</span>
            </div>
            <div style={{ height: 5, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: BRAND, borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
          </div>

          {cycleTasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {cycleTasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#f8fafc', borderRadius: 6 }}>
                  <span style={{ fontSize: 11, color: STATUS_MAP[t.status]?.color || '#94a3b8', fontWeight: 500, minWidth: 70 }}>
                    {STATUS_MAP[t.status]?.label || t.status}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <button onClick={() => onRemoveTask(cycle.id, t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '1px 3px' }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowTaskPicker(v => !v)}
            style={{ fontSize: 11, color: BRAND, background: '#eef0ff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 500 }}
          >
            <Plus size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            Add issues
          </button>
          {showTaskPicker && (
            <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', maxHeight: 180, overflowY: 'auto' }}>
              {availableTasks.length === 0
                ? <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>All issues are already in this cycle.</div>
                : availableTasks.map(t => (
                  <button key={t.id} onClick={() => { onAddTask(cycle.id, t.id); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
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

export default function CyclePanel({
  cycles, tasks, projectId,
  showCycleForm, setShowCycleForm, newCycle, setNewCycle,
  createCycleMut, onUpdateCycle, onDeleteCycle, onAddTask, onRemoveTask,
}) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
          Cycles / Sprints
        </h2>
        <button
          onClick={() => setShowCycleForm(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={13} /> New Cycle
        </button>
      </div>

      {showCycleForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              autoFocus
              value={newCycle.name}
              onChange={e => setNewCycle(p => ({ ...p, name: e.target.value }))}
              placeholder="Cycle name *"
              style={{ flex: '1 1 180px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            />
            <select value={newCycle.status} onChange={e => setNewCycle(p => ({ ...p, status: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
            <input type="date" value={newCycle.start_date} onChange={e => setNewCycle(p => ({ ...p, start_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            <span style={{ color: '#9ca3af', fontSize: 12 }}>→</span>
            <input type="date" value={newCycle.end_date} onChange={e => setNewCycle(p => ({ ...p, end_date: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newCycle.description}
              onChange={e => setNewCycle(p => ({ ...p, description: e.target.value }))}
              placeholder="Description (optional)"
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
            />
            <button onClick={() => setShowCycleForm(false)}
              style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>
              Cancel
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
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 6,
                background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                opacity: !newCycle.name ? 0.5 : 1,
              }}
            >
              {createCycleMut.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {cycles.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No cycles yet. Click "+ New Cycle" to create your first sprint.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {cycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              tasks={tasks}
              onUpdate={onUpdateCycle}
              onDelete={onDeleteCycle}
              onAddTask={onAddTask}
              onRemoveTask={onRemoveTask}
            />
          ))}
        </div>
      )}
    </div>
  )
}
