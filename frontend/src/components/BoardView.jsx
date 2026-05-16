import { useState } from 'react'
import { Link2, Trash2, Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { STATUS_COLS, PRIORITY, SHADOW_SM, SHADOW_LG } from '../constants/theme'

function CardContent({ task, projectCode, hovered, onUpdate, onDelete, isDragOverlay }) {
  const { t } = useTranslation()
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const issueId = `${projectCode}-${task.id.slice(-4).toUpperCase()}`
  const labels = task.labels || []

  return (
    <>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginBottom: 4, fontFamily: 'monospace' }}>{issueId}</div>
      <div style={{ fontSize: 13, color: '#ffffff', lineHeight: 1.4, marginBottom: 6, fontWeight: 400 }}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4, marginBottom: 6 }}>
          {task.description.length > 80 ? task.description.slice(0, 80) + '\u2026' : task.description}
        </div>
      )}
      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
          {labels.map(lb => (
            <span key={lb.id} style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 500,
              background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
            }}>{lb.name}</span>
          ))}
        </div>
      )}
      {task.assigned_agent_name && (
        <div style={{ fontSize: 11, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 7px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
            background: 'rgba(129,140,248,0.12)', color: '#818cf8',
            border: '1px solid rgba(129,140,248,0.25)',
          }}>
            <Bot size={9} />
            {task.assigned_agent_name}
          </span>
        </div>
      )}
      {!task.assigned_agent_name && task.assignee && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
            {task.assignee.charAt(0).toUpperCase()}
          </span>
          {task.assignee}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, color: p.color, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 8 }}>{p.icon}</span> {p.label}
        </span>
        {hovered && !isDragOverlay ? (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/webhook/callback/${task.callback_token}`)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: '2px 4px' }}
            >
              <Link2 size={11} />
            </button>
            <select
              value={task.status}
              onChange={e => onUpdate(task.id, { status: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 4px', background: '#1f1f1f', color: '#ffffff' }}
            >
              <option value="todo">{t('todo')}</option>
              <option value="in_progress">{t('inProgress')}</option>
              <option value="done">{t('done')}</option>
              <option value="failed">{t('failed')}</option>
            </select>
            <button
              onClick={() => { if (confirm(`Delete "${task.title}"?`)) onDelete(task.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: '2px 4px' }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ) : (
          task.due_date && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
              {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          )
        )}
      </div>
    </>
  )
}

function SortableBoardCard({ task, projectCode, onUpdate, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: task.id, data: { task } })

  const style = {
    background: '#181818',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'grab',
    boxShadow: hovered ? SHADOW_LG : SHADOW_SM,
    transition: isDragging ? 'none' : `box-shadow 0.15s, ${transition || ''}`,
    opacity: isDragging ? 0.3 : 1,
    transform: CSS.Transform.toString(transform),
    touchAction: 'none',
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
    >
      <CardContent
        task={task}
        projectCode={projectCode}
        hovered={hovered}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </div>
  )
}

function DroppableColumn({ colKey, colLabel, colColor, tasks, projectCode, onUpdate, onDelete, isOver }) {
  const { t } = useTranslation()
  const { setNodeRef } = useDroppable({ id: colKey })

  const STATUS_LABEL_KEYS = { todo: 'todo', in_progress: 'inProgress', done: 'done', failed: 'failed' }
  const translatedLabel = STATUS_LABEL_KEYS[colKey] ? t(STATUS_LABEL_KEYS[colKey]) : colLabel

  return (
    <div key={colKey} style={{ width: 258, minWidth: 258, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>{translatedLabel}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', padding: '1px 6px', borderRadius: 10 }}>
          {tasks.length}
        </span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            minHeight: 48,
            borderRadius: 8,
            padding: isOver ? 4 : 0,
            background: isOver ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: isOver ? '2px dashed rgba(255,255,255,0.15)' : '2px dashed transparent',
            transition: 'background 0.15s, border-color 0.15s, padding 0.15s',
          }}
        >
          {tasks.map(task => (
            <SortableBoardCard
              key={task.id}
              task={task}
              projectCode={projectCode}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {tasks.length === 0 && !isOver && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.15)', fontSize: 12, textAlign: 'center',
            }}>
              {t('board.noIssues')}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

export default function BoardView({ tasks, projectCode, onUpdate, onDelete, onReorder }) {
  const [activeTask, setActiveTask] = useState(null)
  const [overColumn, setOverColumn] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = (event) => {
    const task = event.active.data.current?.task
    if (task) setActiveTask(task)
  }

  const handleDragOver = (event) => {
    const overId = event.over?.id
    if (overId && STATUS_COLS.some(c => c.key === overId)) {
      setOverColumn(overId)
    } else if (overId) {
      const overTask = tasks.find(t => t.id === overId)
      setOverColumn(overTask?.status || null)
    } else {
      setOverColumn(null)
    }
  }

  const handleDragEnd = (event) => {
    const { active, over } = event
    setActiveTask(null)
    setOverColumn(null)

    if (!over) return

    const task = active.data.current?.task
    if (!task) return

    const isOverAColumn = STATUS_COLS.some(c => c.key === over.id)
    const overTask = tasks.find(t => t.id === over.id)
    const targetStatus = isOverAColumn ? over.id : overTask?.status

    if (!targetStatus) return

    if (targetStatus !== task.status) {
      // Cross-column drag: change status
      onUpdate(task.id, { status: targetStatus })
    } else if (!isOverAColumn && active.id !== over.id && onReorder) {
      // Same-column drag: reorder
      const colTasks = tasks
        .filter(t => t.status === task.status && t.parent_id == null)
        .slice()
        .sort((a, b) => a.position - b.position)
      const oldIdx = colTasks.findIndex(t => t.id === active.id)
      const newIdx = colTasks.findIndex(t => t.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const reordered = arrayMove(colTasks, oldIdx, newIdx)
        onReorder(reordered.map(t => t.id))
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: 'flex', gap: 12, padding: 16, overflowX: 'auto', alignItems: 'flex-start', minHeight: '100%' }}>
        {STATUS_COLS.map(col => {
          const colTasks = tasks
            .filter(t => t.status === col.key && t.parent_id == null)
            .slice()
            .sort((a, b) => a.position - b.position)
          return (
            <DroppableColumn
              key={col.key}
              colKey={col.key}
              colLabel={col.label}
              colColor={col.color}
              tasks={colTasks}
              projectCode={projectCode}
              onUpdate={onUpdate}
              onDelete={onDelete}
              isOver={overColumn === col.key}
            />
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div style={{
            background: '#181818', borderRadius: 8,
            padding: '10px 12px', width: 258,
            boxShadow: '0 12px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
            transform: 'rotate(2deg)',
          }}>
            <CardContent
              task={activeTask}
              projectCode={projectCode}
              hovered={false}
              isDragOverlay
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
