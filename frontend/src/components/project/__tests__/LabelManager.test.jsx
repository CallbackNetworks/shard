import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LabelManager from '../LabelManager'
import { qk } from '../../../api/queryKeys'

const mocks = vi.hoisted(() => ({
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }),
}))

vi.mock('../../../api/client', () => mocks)

const LABELS = [
  { id: 'l1', name: 'bug', color: '#ff5533' },
  { id: 'l2', name: 'chore', color: '#33ff55' },
]

let qc
let invalidateSpy

function renderManager(labels = LABELS) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={qc}>
      <LabelManager labels={labels} projectId="p1" />
    </QueryClientProvider>
  )
  // Everything but the count lives behind the toggle.
  fireEvent.click(screen.getByText(/project.labelsCount/))
  return view
}

async function expectRefreshed() {
  await waitFor(() => {
    const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
    expect(keys).toContain(JSON.stringify(qk.project('p1')))
    expect(keys).toContain(JSON.stringify(qk.projects()))
  })
}

describe('LabelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createLabel.mockResolvedValue({ id: 'l3' })
    mocks.deleteLabel.mockResolvedValue({})
  })

  it('creates a label with the colour picked, then empties the name', async () => {
    renderManager()
    fireEvent.change(screen.getByPlaceholderText('project.labelName'), { target: { value: '  urgent  ' } })
    fireEvent.click(screen.getByText('project.createLabel'))

    // Trimmed: a name with a stray space is the same label to a reader.
    await waitFor(() => expect(mocks.createLabel).toHaveBeenCalledWith('p1', {
      name: 'urgent',
      color: expect.any(String),
    }))
    await expectRefreshed()
    expect(screen.getByPlaceholderText('project.labelName')).toHaveValue('')
  })

  it('will not create a label with no name', () => {
    renderManager()
    expect(screen.getByText('project.createLabel')).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('project.labelName'), { target: { value: '   ' } })
    expect(screen.getByText('project.createLabel')).toBeDisabled()
  })

  it('deletes the label whose chip was clicked', async () => {
    renderManager()
    const chip = screen.getByText('chore')
    fireEvent.click(chip.querySelector('button'))

    await waitFor(() => expect(mocks.deleteLabel).toHaveBeenCalledWith('p1', 'l2'))
    await expectRefreshed()
  })

  it('says so when the project has no labels', () => {
    renderManager([])
    expect(screen.getByText('project.noLabels')).toBeInTheDocument()
  })
})
