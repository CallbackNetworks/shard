import s from './BulkToolbar.module.css'

/** Bulk-selection action bar shown above the issues list. */
export default function BulkToolbar({ selectedCount, onSetStatus, onSetPriority, onPin, onClear }) {
  return (
    <div className={s.bar}>
      <span className={s.count}>{selectedCount} selected</span>
      <select
        onChange={e => { if (e.target.value) { onSetStatus(e.target.value); e.target.value = '' } }}
        className={s.select}
        defaultValue=""
      >
        <option value="" disabled>Set status...</option>
        <option value="todo">Todo</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
        <option value="failed">Failed</option>
      </select>
      <select
        onChange={e => { if (e.target.value) { onSetPriority(e.target.value); e.target.value = '' } }}
        className={s.select}
        defaultValue=""
      >
        <option value="" disabled>Set priority...</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <button onClick={onPin} className={s.pinBtn}>Pin</button>
      <button onClick={onClear} className={s.clearBtn}>Clear</button>
    </div>
  )
}
