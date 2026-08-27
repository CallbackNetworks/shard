import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TaskCreateForm from '../TaskCreateForm'
import { qk } from '../../api/queryKeys'

/**
 * The create used to be declared on the project page and passed in, and the
 * page's own test renders this form as a stub — so the shape it sends had no
 * test anywhere. That shape is the whole point of it: dates leave as ISO,
 * fields left blank are dropped rather than sent empty, and a label is an edge
 * attached after the task exists rather than a field on the create.
 */

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  addLabelToTask: vi.fn(),
  getTemplates: vi.fn(),
  getApiKeys: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../api/client', () => mocks)

vi.mock('../../utils/uiPrefs', () => ({
  getUiPrefs: () => ({ defaultPriority: 'medium' }),
}))

vi.mock('../MarkdownEditor', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="description" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

const LABELS = [
  { id: 'l1', name: 'bug', color: '#ff0000' },
  { id: 'l2', name: 'chore', color: '#00ff00' },
]

let qc
let invalidateSpy
let onCancel

function renderForm(showForm = true) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  onCancel = vi.fn()
  return render(
    <QueryClientProvider client={qc}>
      <TaskCreateForm showForm={showForm} labels={LABELS} onCancel={onCancel} projectId="p1" />
    </QueryClientProvider>
  )
}

const titleBox = () => screen.getByPlaceholderText('taskCreate.issueTitlePlaceholder')
const createBtn = () => screen.getByText('create')

describe('TaskCreateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTask.mockResolvedValue({ id: 'new-task' })
    mocks.addLabelToTask.mockResolvedValue({})
    mocks.getTemplates.mockResolvedValue([])
    mocks.getApiKeys.mockResolvedValue([])
  })

  it('draws nothing while it is closed', () => {
    const { container } = renderForm(false)
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the fields left blank instead of sending them empty', async () => {
    renderForm()
    fireEvent.change(titleBox(), { target: { value: 'Fix the thing' } })
    fireEvent.click(createBtn())

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledWith('p1', {
      title: 'Fix the thing',
      priority: 'medium',
      status: 'todo',
    }))
  })

  it('sends the dates as ISO instants', async () => {
    renderForm()
    fireEvent.change(titleBox(), { target: { value: 'Dated' } })
    const [start, due] = screen.getAllByDisplayValue('').filter(el => el.type === 'date')
    fireEvent.change(start, { target: { value: '2026-01-02' } })
    fireEvent.change(due, { target: { value: '2026-01-09' } })
    fireEvent.click(createBtn())

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled())
    const payload = mocks.createTask.mock.calls[0][1]
    expect(payload.start_date).toBe(new Date('2026-01-02').toISOString())
    expect(payload.due_date).toBe(new Date('2026-01-09').toISOString())
  })

  it('attaches the chosen labels to the task once it exists', async () => {
    renderForm()
    fireEvent.change(titleBox(), { target: { value: 'Labelled' } })
    fireEvent.click(screen.getByText('bug'))
    fireEvent.click(screen.getByText('chore'))
    fireEvent.click(createBtn())

    await waitFor(() => expect(mocks.addLabelToTask).toHaveBeenCalledTimes(2))
    expect(mocks.addLabelToTask).toHaveBeenCalledWith('p1', 'new-task', 'l1')
    expect(mocks.addLabelToTask).toHaveBeenCalledWith('p1', 'new-task', 'l2')
    // The selection is not a task field — it must not ride along on the create.
    expect(mocks.createTask.mock.calls[0][1]).not.toHaveProperty('selectedLabels')
  })

  it('empties itself and closes once the task is created', async () => {
    renderForm()
    fireEvent.change(titleBox(), { target: { value: 'Fix the thing' } })
    fireEvent.click(createBtn())

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
      expect(keys).toContain(JSON.stringify(qk.project('p1')))
      expect(keys).toContain(JSON.stringify(qk.projects()))
    })
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
    expect(titleBox()).toHaveValue('')
  })

  it('creates on Enter in the title, but not from an empty one', async () => {
    renderForm()
    fireEvent.keyDown(titleBox(), { key: 'Enter' })
    expect(mocks.createTask).not.toHaveBeenCalled()

    fireEvent.change(titleBox(), { target: { value: 'Quick one' } })
    fireEvent.keyDown(titleBox(), { key: 'Enter' })
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled())
  })

  it('will not create an untitled task', () => {
    renderForm()
    expect(createBtn()).toBeDisabled()
  })
})
