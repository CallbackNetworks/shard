import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import s from '../../pages/Dashboard.module.css'

function SortableWidgetItem({ id, label, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className={s.widgetSlot}>
      <div className={s.widgetDragHandle} {...attributes} {...listeners}>
        <GripVertical size={12} />
        <span>{label}</span>
      </div>
      {children}
    </div>
  )
}

/* Renders the widgets a column owns, in order — plain and static outside edit mode
   (`editing=false`), droppable/sortable with a drag handle per widget while editing. */
export default function WidgetColumn({ colKey, ids, widgets, editing, emptyLabel }) {
  const present = ids.filter(id => widgets[id])

  if (!editing) {
    return present.map(id => <div key={id}>{widgets[id].node}</div>)
  }

  return <EditingColumn colKey={colKey} ids={present} widgets={widgets} emptyLabel={emptyLabel} />
}

function EditingColumn({ colKey, ids, widgets, emptyLabel }) {
  const { setNodeRef, isOver } = useDroppable({ id: colKey })
  return (
    <div ref={setNodeRef} className={`${s.widgetColumnDrop} ${isOver ? s.widgetColumnDropOver : ''}`}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.length === 0 && <div className={s.widgetColumnEmpty}>{emptyLabel}</div>}
        {ids.map(id => (
          <SortableWidgetItem key={id} id={id} label={widgets[id].label}>
            {widgets[id].node}
          </SortableWidgetItem>
        ))}
      </SortableContext>
    </div>
  )
}
