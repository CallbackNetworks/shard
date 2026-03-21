import { useState, useMemo } from 'react'
import { BRAND, PRIORITY, STATUS_MAP } from '../constants/theme'

export default function TableView({ tasks, projectId, labels, cycles, onUpdate }) {
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState('asc')

  const cycleByTask = useMemo(() => {
    const map = {}
    cycles.forEach(c => c.task_ids.forEach(tid => { map[tid] = c }))
    return map
  }, [cycles])

  const sorted = useMemo(() => {
    const arr = [...tasks]
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av == null) av = ''
      if (bv == null) bv = ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [tasks, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return <span style={{ color: '#d1d5db', fontSize: 10 }}>↕</span>
    return <span style={{ color: BRAND, fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const thStyle = () => ({
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'left',
  })

  const tdStyle = {
    padding: '5px 10px', fontSize: 12, color: '#374151',
    borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead>
          <tr>
            <th style={thStyle()} onClick={() => toggleSort('status')}>
              Status <SortIcon k="status" />
            </th>
            <th style={thStyle()} onClick={() => toggleSort('priority')}>
              Priority <SortIcon k="priority" />
            </th>
            <th style={{ ...thStyle(), minWidth: 200 }} onClick={() => toggleSort('title')}>
              Title <SortIcon k="title" />
            </th>
            <th style={thStyle()} onClick={() => toggleSort('assignee')}>
              Assignee <SortIcon k="assignee" />
            </th>
            <th style={thStyle()}>Labels</th>
            <th style={thStyle()}>Cycle</th>
            <th style={thStyle()} onClick={() => toggleSort('due_date')}>
              Due Date <SortIcon k="due_date" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(task => {
            const cycle = cycleByTask[task.id]
            const taskLabels = task.labels || []
            return (
              <tr key={task.id} style={{ background: '#fff' }}>
                <td style={tdStyle}>
                  <select
                    value={task.status}
                    onChange={e => onUpdate(task.id, { status: e.target.value })}
                    style={{
                      fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4,
                      padding: '2px 6px', background: '#fff', color: STATUS_MAP[task.status]?.color || '#374151',
                    }}
                  >
                    <option value="todo">Todo</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                    <option value="failed">Failed</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <select
                    value={task.priority}
                    onChange={e => onUpdate(task.id, { priority: e.target.value })}
                    style={{
                      fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4,
                      padding: '2px 6px', background: '#fff',
                      color: PRIORITY[task.priority]?.color || '#374151',
                    }}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </td>
                <td style={{ ...tdStyle, maxWidth: 320 }}>
                  <span style={{
                    textDecoration: task.status === 'done' ? 'line-through' : 'none',
                    color: task.status === 'done' ? '#9ca3af' : '#0f172a',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                  }}>
                    {task.title}
                  </span>
                </td>
                <td style={tdStyle}>
                  <input
                    value={task.assignee || ''}
                    onChange={e => onUpdate(task.id, { assignee: e.target.value || null })}
                    placeholder="—"
                    style={{
                      width: 80, fontSize: 11, border: '1px solid transparent', borderRadius: 4,
                      padding: '2px 6px', background: 'transparent', outline: 'none',
                      color: task.assignee ? '#374151' : '#d1d5db',
                    }}
                    onFocus={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.background = '#fff' }}
                    onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent' }}
                  />
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
                    {taskLabels.slice(0, 3).map(lb => (
                      <span key={lb.id} style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 500,
                        background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
                      }}>{lb.name}</span>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  {cycle ? (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#eef0ff', color: BRAND,
                      fontWeight: 500, whiteSpace: 'nowrap',
                    }}>
                      {cycle.name}
                    </span>
                  ) : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  {task.due_date
                    ? <span style={{ whiteSpace: 'nowrap', color: '#374151' }}>
                        {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    : <span style={{ color: '#d1d5db' }}>—</span>
                  }
                </td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No issues yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
