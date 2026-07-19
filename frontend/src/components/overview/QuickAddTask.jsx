import { useState, useCallback } from 'react'
import { createTask } from '../../api/client'
import { useInvalidatingMutation } from '../../hooks/useCrudMutations'
import s from './QuickAddTask.module.css'

/** Inline task creator shown on overview project cards. */
export default function QuickAddTask({ projectId }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const addMut = useInvalidatingMutation({
    mutationFn: (data) => createTask(projectId, data),
    invalidateKeys: [['projects']],
    onSuccess: () => { setTitle(''); setOpen(false) },
  })
  const submit = useCallback(() => {
    if (!title.trim()) return
    addMut.mutate({ title: title.trim(), priority: 'medium' })
  }, [title, addMut])

  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true) }} className={s.openBtn}>
        + TASK
      </button>
    )
  }

  return (
    <div onClick={e => e.stopPropagation()} className={s.inputRow}>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder="Task title..."
        autoFocus
        className={s.input}
      />
      <button onClick={submit} disabled={!title.trim()} className={s.addBtn} style={{ opacity: title.trim() ? 1 : 0.4 }}>
        ADD
      </button>
      <button onClick={() => setOpen(false)} className={s.cancelBtn}>✕</button>
    </div>
  )
}
