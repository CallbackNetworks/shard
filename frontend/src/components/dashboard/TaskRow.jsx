import { useState } from 'react'
import { Clock } from 'lucide-react'
import { STATUS_MAP, PRIORITY, DARK, STATUS_COLOR } from '../../constants/theme'
import s from '../../pages/Dashboard.module.css'

/* ── Task row (shared by Due Soon and My Work sections) ───────────── */
export default function TaskRow({ t: task, i, total, onClick }) {
  const [hov, setHov] = useState(false)
  const sc = STATUS_MAP[task.status]?.color || DARK.textMid
  const pc = PRIORITY[task.priority]?.color || DARK.textMid
  const overdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={`${s.taskRow} ${overdue ? s.taskRowOverdue : ''} ${!overdue && hov ? s.taskRowHover : ''}`}
      style={{
        borderBottom: i < total - 1 ? `1px solid ${DARK.border}` : 'none',
      }}
    >
      <div className={s.taskStatusDot} style={{ background: sc, boxShadow: `0 0 5px ${sc}66` }} />
      <span className={s.taskPriorityIcon} style={{ color: pc }}>
        {PRIORITY[task.priority]?.icon}
      </span>
      <div className={s.taskTitleWrap}>
        <div className={s.taskTitle} style={{
          color: task.status === 'done' ? DARK.textDim : DARK.textMid,
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>
      </div>
      <span className={s.taskProject}>{task.projectName}</span>
      {task.due_date && (
        <span className={s.taskDueDate} style={{
          color: overdue ? STATUS_COLOR.failed : DARK.textDim,
        }}>
          <Clock size={9} />
          {new Date(task.due_date).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}
