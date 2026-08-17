/**
 * A subtask is work, so it is on the board (ADR-0094).
 *
 * The board dropped every task with a `parent_id`. In production that meant the `n8n`
 * project — whose ten pieces are all filed under one parent task — showed exactly one
 * card, and the six of them already done were nowhere on screen. Showing them is only
 * half the fix: an unattributed card reads as ten unrelated jobs, so the card has to name
 * the work it is part of.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BoardView from '../BoardView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }),
}))
// The card's type badge reads the node-type registry; nothing here is about that.
vi.mock('../../api/client', () => ({ getNodeTypes: vi.fn().mockResolvedValue([]) }))

const TASKS = [
  { id: 'p', title: 'Deploy the workflow', status: 'in_progress', priority: 'medium', parent_id: null, position: 0 },
  { id: 's1', title: 'Enable the orchestrator', status: 'todo', priority: 'medium', parent_id: 'p', position: 1 },
  { id: 's2', title: 'Verify LINE', status: 'done', priority: 'low', parent_id: 'p', position: 2 },
]

const renderBoard = (tasks = TASKS) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BoardView tasks={tasks} projectCode="N8N" onUpdate={vi.fn()} onDelete={vi.fn()} onReorder={vi.fn()} />
    </QueryClientProvider>
  )

describe('BoardView', () => {
  it('shows subtasks as cards in their own status column', () => {
    renderBoard()
    expect(screen.getByText('Deploy the workflow')).toBeInTheDocument()
    expect(screen.getByText('Enable the orchestrator')).toBeInTheDocument()
    expect(screen.getByText('Verify LINE')).toBeInTheDocument()
  })

  it('names the parent on each subtask card', () => {
    renderBoard()
    expect(screen.getAllByText('↳ Deploy the workflow')).toHaveLength(2)
  })

  it('leaves a top-level card unattributed', () => {
    renderBoard([TASKS[0]])
    expect(screen.queryByText(/↳/)).toBeNull()
  })

  it('does not attribute a subtask whose parent a filter removed', () => {
    // Same rule as everywhere else: parenting resolves within the visible set, and a
    // child of a filtered-out parent stays on the board rather than vanishing with it.
    renderBoard([TASKS[1]])
    expect(screen.getByText('Enable the orchestrator')).toBeInTheDocument()
    expect(screen.queryByText(/↳/)).toBeNull()
  })
})
