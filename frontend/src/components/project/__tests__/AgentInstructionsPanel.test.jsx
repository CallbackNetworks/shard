import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AgentInstructionsPanel from '../AgentInstructionsPanel'
import { qk } from '../../../api/queryKeys'

/**
 * The draft rules are the part that a move breaks quietly: the panel hides
 * itself rather than being unmounted by the toggle, so an unfinished
 * instruction survives closing it, and it refuses to overwrite that draft with
 * a value that arrived from somewhere else.
 */

const mocks = vi.hoisted(() => ({ updateProject: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../../api/client', () => mocks)

const PROJECT = { id: 'p1', agent_instructions: 'run the tests', repo_url: 'https://git/x' }

let qc
let invalidateSpy

function renderPanel(project = PROJECT, open = true) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const ui = (p, o) => (
    <QueryClientProvider client={qc}>
      <AgentInstructionsPanel open={o} project={p} />
    </QueryClientProvider>
  )
  const view = render(ui(project, open))
  return { ...view, update: (p, o) => view.rerender(ui(p, o)) }
}

const instructionsBox = () => screen.getByPlaceholderText('project.agentInstrPlaceholder')
const repoBox = () => screen.getByPlaceholderText('project.repoUrlPlaceholder')

describe('AgentInstructionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProject.mockResolvedValue({})
  })

  it('shows what the project has stored', () => {
    renderPanel()
    expect(instructionsBox()).toHaveValue('run the tests')
    expect(repoBox()).toHaveValue('https://git/x')
  })

  it('offers no save until something is edited', () => {
    renderPanel()
    expect(screen.queryByText('save')).toBeNull()
    fireEvent.change(instructionsBox(), { target: { value: 'run the tests twice' } })
    expect(screen.getByText('save')).toBeInTheDocument()
  })

  it('saves both fields together, sending null for an empty one', async () => {
    renderPanel()
    fireEvent.change(instructionsBox(), { target: { value: 'run the tests twice' } })
    fireEvent.change(repoBox(), { target: { value: '' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('p1', {
      agent_instructions: 'run the tests twice',
      repo_url: null,
    }))
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
      expect(keys).toContain(JSON.stringify(qk.project('p1')))
      expect(keys).toContain(JSON.stringify(qk.projects()))
    })
  })

  it('keeps an unsaved draft while the panel is closed', () => {
    const { update } = renderPanel()
    fireEvent.change(instructionsBox(), { target: { value: 'half a thought' } })
    update(PROJECT, false)
    expect(screen.queryByPlaceholderText('project.agentInstrPlaceholder')).toBeNull()
    update(PROJECT, true)
    expect(instructionsBox()).toHaveValue('half a thought')
  })

  it('takes in a value saved elsewhere, but not over a draft', () => {
    const { update } = renderPanel()
    update({ ...PROJECT, agent_instructions: 'changed elsewhere' }, true)
    expect(instructionsBox()).toHaveValue('changed elsewhere')

    fireEvent.change(instructionsBox(), { target: { value: 'mine' } })
    update({ ...PROJECT, agent_instructions: 'changed again' }, true)
    expect(instructionsBox()).toHaveValue('mine')
  })

  it('discards the draft on cancel', () => {
    renderPanel()
    fireEvent.change(instructionsBox(), { target: { value: 'mine' } })
    fireEvent.click(screen.getByText('cancel'))
    expect(instructionsBox()).toHaveValue('run the tests')
    expect(screen.queryByText('save')).toBeNull()
  })
})
