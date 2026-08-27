import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bulkUpdateTasks } from '../api/client'
import { qk } from '../api/queryKeys'

/**
 * Selecting several tasks and acting on all of them at once.
 *
 * This is a hook rather than a component because the selection is read in three
 * places that cannot be nested inside one another: the filter strip draws the
 * toggle, the issue list draws a checkbox per row, and the action bar sits
 * between them. What a component could own is the rules, and those were the part
 * spread out — the page cleared the selection when the toggle flipped, and the
 * mutation cleared it again on success, in two handlers that had to agree.
 */
export default function useBulkSelection(projectId) {
  const qc = useQueryClient()
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  const applyMut = useMutation({
    mutationFn: (data) => bulkUpdateTasks(projectId, { task_ids: [...selected], ...data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.project(projectId) })
      qc.invalidateQueries({ queryKey: qk.projects() })
      setSelected(new Set())
      setActive(false)
    },
  })

  return {
    active,
    count: selected.size,
    pending: applyMut.isPending,
    isSelected: (taskId) => selected.has(taskId),
    // Turning bulk mode off drops the selection with it: the checkboxes that
    // named it are gone, so a selection that outlived them would be one the next
    // bulk action silently inherited.
    toggleActive: () => { setSelected(new Set()); setActive(v => !v) },
    toggleTask: (taskId, checked) => setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(taskId)
      else next.delete(taskId)
      return next
    }),
    clear: () => setSelected(new Set()),
    // Callers say what to change, never who to change it on — the selection is
    // the hook's, and spelling it at each call site is how one of them ends up
    // sending a stale list.
    apply: (data) => applyMut.mutate(data),
  }
}
