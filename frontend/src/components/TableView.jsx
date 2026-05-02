import { useState, useMemo } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BRAND, PRIORITY, STATUS_MAP } from '../constants/theme'

function SortableRow({ task, cycleByTask, onUpdate, tdStyle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const cycle = cycleByTask[task.id]
  const taskLabels = task.labels || []

  const style = {
    background: isDragging ? 'rgba(129,140,248,0.08)' : 'transparent',
    opacity: isDragging ? 0.6 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <tr ref={setNodeRef} style={style}>
      <td style={{ ...tdStyle, width: 24, cursor: 'grab', color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}
          {...listeners} {...attributes}>
        ⠿
      </td>
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
}

export default function TableView({ tasks, projectId, labels, cycles, onUpdate, onReorder }) {
  const [sortKey, setSortKey] = useState('position')
  const [sortDir, setSortDir] = useState('asc')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const cycleByTask = useMemo(() => {
    const map = {}
    cycles.forEach(c => c.task_ids.forEach(tid => { map[tid] = c }))
    return map
  }, [cycles])

  const sorted = useMemo(() => {
    const arr = [...tasks]
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av == null) av = sortKey === 'position' ? 0 : ''
      if (bv == null) bv = sortKey === 'position' ? 0 : ''
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

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id || !onReorder) return
    const oldIdx = sorted.findIndex(t => t.id === active.id)
    const newIdx = sorted.findIndex(t => t.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) {
      const reordered = arrayMove(sorted, oldIdx, newIdx)
      onReorder(reordered.map(t => t.id))
    }
  }

  const isDragMode = sortKey === 'position' && onReorder

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle(), width: 24, cursor: 'default' }}
                  title="Drag to reorder (active when sorted by position)">
              </th>
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
          <SortableContext items={sorted.map(t => t.id)} strategy={verticalListSortingStrategy} disabled={!isDragMode}>
            <tbody>
              {sorted.map(task => (
                <SortableRow
                  key={task.id}
                  task={task}
                  cycleByTask={cycleByTask}
                  onUpdate={onUpdate}
                  tdStyle={tdStyle}
                />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: 40 }}>
                    No issues yet.
                  </td>
                </tr>
              )}
            </tbody>
          </SortableContext>
        </table>
      </div>
    </DndContext>
  )
}
