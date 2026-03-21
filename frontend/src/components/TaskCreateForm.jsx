import { BRAND } from '../constants/theme'
import MarkdownEditor from './MarkdownEditor'

export default function TaskCreateForm({ showForm, newTask, setNewTask, createMut, labels, onCancel }) {
  if (!showForm) return null

  return (
    <div style={{ padding: '10px 24px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          autoFocus
          value={newTask.title}
          onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
          placeholder="Issue title *"
          onKeyDown={e => e.key === 'Enter' && newTask.title && createMut.mutate(newTask)}
          style={{ flex: '1 1 200px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none' }}
        />
        <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          value={newTask.assignee}
          onChange={e => setNewTask(p => ({ ...p, assignee: e.target.value }))}
          placeholder="Assignee"
          style={{ width: 100, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, outline: 'none' }}
        />
        <input type="date" value={newTask.start_date} onChange={e => setNewTask(p => ({ ...p, start_date: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
        <span style={{ color: '#9ca3af', fontSize: 12 }}>→</span>
        <input type="date" value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
        <button onClick={onCancel}
          style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
        <button
          disabled={!newTask.title || createMut.isPending}
          onClick={() => createMut.mutate(newTask)}
          style={{
            padding: '6px 14px', border: 'none', borderRadius: 6,
            background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            opacity: !newTask.title ? 0.5 : 1,
          }}
        >
          {createMut.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
      <div style={{ marginTop: 6 }}>
        <MarkdownEditor
          value={newTask.description}
          onChange={(val) => setNewTask(p => ({ ...p, description: val }))}
          placeholder="Description (optional, supports Markdown)"
          minHeight={80}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Labels:</span>
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
                    fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500, cursor: 'pointer',
                    background: selected ? lb.color + '22' : '#f3f4f6',
                    color: selected ? lb.color : '#6b7280',
                    border: selected ? `1px solid ${lb.color}44` : '1px solid #e5e7eb',
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
