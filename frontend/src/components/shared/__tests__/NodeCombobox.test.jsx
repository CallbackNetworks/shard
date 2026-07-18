import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import NodeCombobox from '../NodeCombobox'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  getNodes: vi.fn(),
  getNodeTypes: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
}))

vi.mock('../../../api/client', () => ({
  getNodes: mocks.getNodes,
  getNodeTypes: mocks.getNodeTypes,
}))

const nodeTypes = [
  { key: 'task', label: 'Task', color: '#22c55e' },
  { key: 'topic', label: 'Topic', color: '#f59e0b' },
]
const hits = [
  { id: 'n1', type: 'topic', title: 'Research' },
  { id: 'n2', type: 'task', title: 'Refactor' },
  { id: 'n3', type: 'topic', title: '' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    return { data: hits, isFetching: false }
  })
})

describe('NodeCombobox', () => {
  it('opens on focus and lists options with type labels', () => {
    render(<NodeCombobox onSelect={() => {}} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('Refactor')).toBeInTheDocument()
    expect(screen.getAllByText('Topic')).toHaveLength(2)
    expect(screen.getByText('nodeCombobox.untitled')).toBeInTheDocument()
  })

  it('excludes ids and applies the client-side filter', () => {
    render(<NodeCombobox onSelect={() => {}} excludeIds={['n2']} filter={n => n.type === 'topic'} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.queryByText('Refactor')).not.toBeInTheDocument()
  })

  it('selects an option on click and clears the input', () => {
    const onSelect = vi.fn()
    render(<NodeCombobox onSelect={onSelect} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Res' } })
    fireEvent.mouseDown(screen.getByText('Research'))
    expect(onSelect).toHaveBeenCalledWith(hits[0])
    expect(input.value).toBe('')
  })

  it('supports keyboard navigation with Enter', () => {
    const onSelect = vi.fn()
    render(<NodeCombobox onSelect={onSelect} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(hits[1])
  })

  it('shows an empty message when nothing matches', () => {
    mocks.useQuery.mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'node-types') return { data: nodeTypes }
      return { data: [], isFetching: false }
    })
    render(<NodeCombobox onSelect={() => {}} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByText('nodeCombobox.noResults')).toBeInTheDocument()
  })
})
