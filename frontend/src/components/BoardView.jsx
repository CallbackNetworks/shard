import { useMemo, useState } from 'react'
import { Trash2, Bot } from 'lucide-react'
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
import { STATUS_COLS, PRIORITY, SHADOW_SM, SHADOW_LG, DARK } from '../constants/theme'
import { TypeBadge } from './TaskIcons'
import { alpha } from '../utils/color'
import { parentIndex } from '../utils/taskTree'

function CardContent({ task, parent, projectCode, hovered, onUpdate, onDelete, isDragOverlay }) {
  const { t } = useTranslation()
  const p = PRIORITY[task.priority] || PRIORITY.medium
  const issueId = `${projectCode}-${task.id.slice(-4).toUpperCase()}`
  const labels = task.labels || []

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.25)', fontFamily: 'monospace' }}>{issueId}</span>
        <TypeBadge type={task.type} />
      </div>
      {/* A subtask is on the board now (ADR-0094), so the card has to say what it is
          part of — an unattributed card is how ten pieces of one job read as ten jobs. */}
      {parent && (
        <div
          title={t('board.partOf', { title: parent.title })}
          style={{
            fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.4)', marginBottom: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          ↳ {parent.title}
        </div>
      )}
      <div style={{ fontSize: 13, color: DARK.text, lineHeight: 1.4, marginBottom: 6, fontWeight: 400 }}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.35)', lineHeight: 1.4, marginBottom: 6 }}>
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
            background: DARK.infoBg, color: DARK.info,
            border: `1px solid ${alpha(DARK.info, 30)}`,
          }}>
            <Bot size={9} />
            {task.assigned_agent_name}
          </span>
        </div>
      )}
      {!task.assigned_agent_name && task.assignee && (
        <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.35)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(var(--kt-ink-rgb), 0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'rgba(var(--kt-ink-rgb), 0.5)' }}>
            {task.assignee.charAt(0).toUpperCase()}
          </span>
          {task.assignee}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, color: p.color, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 8 }}>{p.icon}</span> {t(p.labelKey)}
        </span>
        {hovered && !isDragOverlay ? (
          <div style={{ display: 'flex', gap: 2 }}>
            {/* A one-click "copy webhook URL" used to sit here. The URL alone no longer
                configures anything — the callback rejects unsigned requests (ADR-0060) —
                so setup lives in the task's webhook panel, which hands over the URL and
                the signing key together. */}
            <select
              value={task.status}
              onChange={e => onUpdate(task.id, { status: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 4, padding: '2px 4px', background: DARK.elevated, color: DARK.text }}
            >
              <option value="todo">{t('todo')}</option>
              <option value="in_progress">{t('inProgress')}</option>
              <option value="done">{t('done')}</option>
              <option value="failed">{t('failed')}</option>
            </select>
            <button
              onClick={() => { if (confirm(`Delete "${task.title}"?`)) onDelete(task.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--kt-ink-rgb), 0.25)', padding: '2px 4px' }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ) : (
          task.due_date && (
            <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.25)' }}>
              {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          )
        )}
      </div>
    </>
  )
}

function SortableBoardCard({ task, parent, projectCode, onUpdate, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: task.id, data: { task } })

  const style = {
    background: DARK.surface,
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
        parent={parent}
        projectCode={projectCode}
        hovered={hovered}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </div>
  )
}

function DroppableColumn({ colKey, colLabel, colColor, tasks, parents, projectCode, onUpdate, onDelete, isOver, wipLimit }) {
  const { t } = useTranslation()
  const { setNodeRef } = useDroppable({ id: colKey })

  const STATUS_LABEL_KEYS = { todo: 'todo', in_progress: 'inProgress', done: 'done', failed: 'failed' }
  const translatedLabel = STATUS_LABEL_KEYS[colKey] ? t(STATUS_LABEL_KEYS[colKey]) : colLabel
  const overWip = wipLimit && tasks.length > wipLimit

  return (
    <div key={colKey} style={{ width: 258, minWidth: 258, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: overWip ? DARK.warning : colColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: overWip ? DARK.warning : DARK.text }}>{translatedLabel}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, padding: '1px 6px', borderRadius: 10,
          background: overWip ? DARK.warningBg : 'rgba(var(--kt-ink-rgb), 0.06)',
          color: overWip ? DARK.warning : 'rgba(var(--kt-ink-rgb), 0.35)',
          fontWeight: overWip ? 700 : 400,
        }}>
          {tasks.length}{wipLimit ? ` / ${wipLimit}` : ''}
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
            background: isOver ? 'rgba(var(--kt-ink-rgb), 0.04)' : 'transparent',
            border: isOver ? '2px dashed rgba(var(--kt-ink-rgb), 0.15)' : '2px dashed transparent',
            transition: 'background 0.15s, border-color 0.15s, padding 0.15s',
          }}
        >
          {tasks.map(task => (
            <SortableBoardCard
              key={task.id}
              task={task}
              parent={parents?.get(task.id)}
              projectCode={projectCode}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {tasks.length === 0 && !isOver && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              border: '1px dashed rgba(var(--kt-ink-rgb), 0.08)', color: 'rgba(var(--kt-ink-rgb), 0.15)', fontSize: 12, textAlign: 'center',
            }}>
              {t('board.noIssues')}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

export default function BoardView({ tasks, projectCode, onUpdate, onDelete, onReorder, wipLimits = {} }) {
  const [activeTask, setActiveTask] = useState(null)
  const [overColumn, setOverColumn] = useState(null)
  // Subtasks are cards like any other (ADR-0094); this is only how each one names the
  // work it belongs to. Resolved within the visible set, so a filtered-out parent leaves
  // its children on the board unattributed rather than removing them.
  const parents = useMemo(() => parentIndex(tasks), [tasks])

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
        .filter(t => t.status === task.status)
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
            .filter(t => t.status === col.key)
            .slice()
            .sort((a, b) => a.position - b.position)
          return (
            <DroppableColumn
              key={col.key}
              colKey={col.key}
              parents={parents}
              colLabel={col.label}
              colColor={col.color}
              tasks={colTasks}
              projectCode={projectCode}
              onUpdate={onUpdate}
              onDelete={onDelete}
              isOver={overColumn === col.key}
              wipLimit={wipLimits[col.key]}
            />
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div style={{
            background: DARK.surface, borderRadius: 8,
            padding: '10px 12px', width: 258,
            boxShadow: '0 12px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--kt-ink-rgb), 0.1)',
            transform: 'translateY(-2px)',
          }}>
            <CardContent
              task={activeTask}
              parent={parents.get(activeTask.id)}
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
