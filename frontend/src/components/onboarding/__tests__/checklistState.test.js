import { describe, it, expect } from 'vitest'
import { deriveChecklist, CHECKLIST_STEPS } from '../checklistState'

/**
 * The checklist is derived, never stored (ADR-0148). These assert the property
 * that makes that worth doing: it cannot claim a step is done once the data behind
 * it is gone, which is the one way a stored checklist always eventually lies.
 */
describe('deriveChecklist', () => {
  it('starts at nothing done and points at the first step', () => {
    const state = deriveChecklist({})
    expect(state.completed).toBe(0)
    expect(state.total).toBe(CHECKLIST_STEPS.length)
    expect(state.next.id).toBe('project')
    expect(state.allDone).toBe(false)
  })

  it('ticks a step from live data', () => {
    const state = deriveChecklist({ projects: [{ id: 'p1', tasks: [] }] })
    expect(state.done.project).toBe(true)
    expect(state.done.task).toBe(false)
    expect(state.next.id).toBe('task')
  })

  it('un-ticks when the data behind a step is deleted', () => {
    const withTask = deriveChecklist({ projects: [{ id: 'p1', tasks: [{ id: 't1' }] }] })
    const without = deriveChecklist({ projects: [{ id: 'p1', tasks: [] }] })
    expect(withTask.done.task).toBe(true)
    expect(without.done.task).toBe(false)
  })

  // Either way of organising counts. Insisting on one leaves somebody who did the
  // other looking at an unticked box for work they actually did.
  it('accepts a label or a subtask as organising', () => {
    const byLabel = deriveChecklist({ projects: [{ tasks: [{ id: 't1', labels: [{ id: 'l1' }] }] }] })
    const bySubtask = deriveChecklist({ projects: [{ tasks: [{ id: 't1' }, { id: 't2', parent_id: 't1' }] }] })
    expect(byLabel.done.organise).toBe(true)
    expect(bySubtask.done.organise).toBe(true)
  })

  it('accepts a rule or an integration as automating', () => {
    expect(deriveChecklist({ rules: [{ id: 'r1' }] }).done.automate).toBe(true)
    expect(deriveChecklist({ integrations: [{ id: 'i1' }] }).done.automate).toBe(true)
  })

  it('reports all done with nothing left to point at', () => {
    const state = deriveChecklist({
      projects: [{ id: 'p1', tasks: [{ id: 't1', due_date: '2026-01-01', labels: [{ id: 'l1' }] }] }],
      decisions: [{ id: 'd1' }],
      rules: [{ id: 'r1' }],
    })
    expect(state.allDone).toBe(true)
    expect(state.next).toBeNull()
  })
})
