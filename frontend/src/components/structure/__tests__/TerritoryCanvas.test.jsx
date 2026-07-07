import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTerritoryModel } from '../../../utils/territoryModel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options?.count !== undefined ? `${key}:${options.count}` : key),
  }),
}))

import TerritoryCanvas from '../TerritoryCanvas'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const identities = [
  { id: 'i1', type: 'identity', name: 'Ops', color: '#facc15' },
]

const projects = [
  {
    id: 'p1', type: 'project', name: 'Solo Ops', risk: 'normal', progress: 50,
    doneTasks: 1, totalTasks: 2, failed: 0, overdue: 0, identityIds: ['i1'],
  },
  {
    id: 'p2', type: 'project', name: 'Burning', risk: 'failed', progress: 10,
    doneTasks: 0, totalTasks: 3, failed: 1, overdue: 1, identityIds: [],
  },
]

const tasks = [
  { id: 't1', type: 'task', projectId: 'p1', name: 'Quiet task', risk: 'active', status: 'in_progress', color: '#facc15', blockedBy: [], blocking: [] },
  { id: 't2', type: 'task', projectId: 'p2', name: 'Broken task', risk: 'failed', status: 'failed', color: '#fb7185', blockedBy: [], blocking: [] },
]

const goals = [
  { id: 'g1', type: 'goal', name: 'Ship it', progress: 40, projectIds: ['p1'] },
]

const decisions = [
  { id: 'd1', type: 'decision', name: 'Pick stack', status: 'proposed', projectId: 'p1' },
]

function setup(overrides = {}) {
  const model = buildTerritoryModel({ projects, identities, tasks, goals, decisions })
  const props = {
    model,
    dependencyLinks: [],
    selected: null,
    selectedNodeKey: null,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    showEmpty: false,
    onClearFilters: vi.fn(),
    ...overrides,
  }
  const utils = render(<TerritoryCanvas {...props} />)
  return { ...utils, props }
}

describe('TerritoryCanvas', () => {
  it('renders territories, lanes, goal rail, and project cards', () => {
    setup()
    expect(screen.getByText('Ops')).toBeTruthy()
    expect(screen.getByText('Solo Ops')).toBeTruthy()
    expect(screen.getByText('Burning')).toBeTruthy()
    expect(screen.getByText('Ship it')).toBeTruthy()
    expect(screen.getByText('structure.unowned')).toBeTruthy()
  })

  it('auto-expands risky projects so their tasks show immediately', () => {
    setup()
    expect(screen.getByText('Broken task')).toBeTruthy()
    expect(screen.queryByText('Quiet task')).toBeNull()
  })

  it('selects and expands a project on card click', () => {
    const { props } = setup()
    fireEvent.click(screen.getByText('Solo Ops'))
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', type: 'project' }))
    expect(screen.getByText('Quiet task')).toBeTruthy()
    expect(screen.getByText('Pick stack')).toBeTruthy()
  })

  it('selects a task chip without bubbling a project selection', () => {
    const { props } = setup()
    fireEvent.click(screen.getByText('Broken task'))
    expect(props.onSelect).toHaveBeenCalledTimes(1)
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't2', type: 'task' }))
  })

  it('selects a goal from the rail', () => {
    const { props } = setup()
    fireEvent.click(screen.getByText('Ship it'))
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', type: 'goal' }))
  })

  it('shows the empty state with a clear-filters action', () => {
    const emptyModel = buildTerritoryModel({ projects: [], identities: [], tasks: [], goals: [], decisions: [] })
    const { props } = setup({ model: emptyModel, showEmpty: true })
    fireEvent.click(screen.getByText('structure.clearFilters'))
    expect(props.onClearFilters).toHaveBeenCalled()
  })
})
