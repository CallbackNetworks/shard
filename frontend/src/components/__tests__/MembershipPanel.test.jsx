import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MembershipPanel from '../MembershipPanel'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useQuery: vi.fn(),
  getProjects: vi.fn(),
  addTaskMembership: vi.fn(() => Promise.resolve()),
  removeTaskMembership: vi.fn(() => Promise.resolve()),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getProjects: mocks.getProjects,
  addTaskMembership: mocks.addTaskMembership,
  removeTaskMembership: mocks.removeTaskMembership,
}))

const projects = [
  { id: 'pA', name: 'Alpha' },
  { id: 'pB', name: 'Beta' },
  { id: 'pC', name: 'Gamma' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({ data: projects })
})

const task = { id: 't1', project_ids: ['pA', 'pB'] }

describe('MembershipPanel', () => {
  it('lists memberships and marks the current project', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
    // The current project chip is annotated; Beta (secondary) is not.
    expect(screen.getByText(/Alpha.*membership\.thisProject/)).toBeInTheDocument()
  })

  it('only offers projects that are not already linked and not the current one', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Gamma')
    expect(options).not.toContain('Alpha')
    expect(options).not.toContain('Beta')
  })

  it('unlinks a secondary membership', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    fireEvent.click(screen.getByLabelText('unlink'))
    expect(mocks.removeTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pB')
  })

  it('links the task into another project', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pC' } })
    fireEvent.click(screen.getByText('membership.link'))
    expect(mocks.addTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pC')
  })
})
