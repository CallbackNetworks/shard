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
    if (sortKey !== k) return <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10 }}>↕</span>
    return <span style={{ color: BRAND, fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const thStyle = () => ({
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
    background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'left',
  })

  const tdStyle = {
    padding: '5px 10px', fontSize: 12, color: '#ffffff',
    borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'middle',
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
            <th style={thStyle()} onClick={() => toggleSort('time_spent')}>
              Time <SortIcon k="time_spent" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(task => {
            const cycle = cycleByTask[task.id]
            const taskLabels = task.labels || []
            return (
              <tr key={task.id} style={{ background: 'transparent' }}>
                <td style={tdStyle}>
                  <select
                    value={task.status}
                    onChange={e => onUpdate(task.id, { status: e.target.value })}
                    style={{
                      fontSize: 11, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
                      padding: '2px 6px', background: '#181818', color: STATUS_MAP[task.status]?.color || '#ffffff',
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
                      fontSize: 11, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
                      padding: '2px 6px', background: '#181818',
                      color: PRIORITY[task.priority]?.color || '#ffffff',
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
                    color: task.status === 'done' ? 'rgba(255,255,255,0.25)' : '#ffffff',
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
                      color: task.assignee ? '#ffffff' : 'rgba(255,255,255,0.15)',
                    }}
                    onFocus={e => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; e.target.style.background = 'rgba(255,255,255,0.05)' }}
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
                      fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(30,215,96,0.12)', color: BRAND,
                      fontWeight: 500, whiteSpace: 'nowrap',
                    }}>
                      {cycle.name}
                    </span>
                  ) : <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  {task.due_date
                    ? <span style={{ whiteSpace: 'nowrap', color: '#ffffff' }}>
                        {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    : <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>
                  }
                </td>
                <td style={tdStyle}>
                  {(task.time_spent || task.time_estimate) ? (
                    <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.5)' }}>
                      {task.time_spent ? `${Math.floor(task.time_spent / 60)}h${task.time_spent % 60 ? `${task.time_spent % 60}m` : ''}` : '\u2014'}
                      {task.time_estimate ? ` / ${Math.floor(task.time_estimate / 60)}h${task.time_estimate % 60 ? `${task.time_estimate % 60}m` : ''}` : ''}
                    </span>
                  ) : <span style={{ color: 'rgba(255,255,255,0.15)' }}>{'\u2014'}</span>}
                </td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: 40 }}>
                No issues yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
