import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ImportPanel from '../ImportPanel'
import { qk } from '../../../api/queryKeys'

/**
 * Nothing tested this flow while it lived inline in `ProjectDetail`, and its
 * whole job is what happens to text a person pasted: a single object still
 * counts as an import, and a JSON error has to come back naming the problem
 * instead of throwing away what was typed.
 */

const mocks = vi.hoisted(() => ({ importTasks: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../../api/client', () => mocks)

let qc
let invalidateSpy
let onClose

function renderPanel() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  onClose = vi.fn()
  return render(
    <QueryClientProvider client={qc}>
      <ImportPanel projectId="p1" onClose={onClose} />
    </QueryClientProvider>
  )
}

const box = () => screen.getByRole('textbox')
const importBtn = () => screen.getByText('project.importAction')

const paste = (text) => fireEvent.change(box(), { target: { value: text } })

describe('ImportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.importTasks.mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
  })

  it('imports a pasted array, then clears itself and closes', async () => {
    renderPanel()
    paste('[{"title": "One"}, {"title": "Two"}]')
    fireEvent.click(importBtn())

    await waitFor(() => expect(mocks.importTasks).toHaveBeenCalledWith('p1', {
      tasks: [{ title: 'One' }, { title: 'Two' }],
    }))
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
      expect(keys).toContain(JSON.stringify(qk.project('p1')))
      expect(keys).toContain(JSON.stringify(qk.projects()))
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(box()).toHaveValue('')
  })

  it('takes a single task object as an import of one', async () => {
    renderPanel()
    paste('{"title": "Just one"}')
    fireEvent.click(importBtn())

    await waitFor(() => expect(mocks.importTasks).toHaveBeenCalledWith('p1', {
      tasks: [{ title: 'Just one' }],
    }))
  })

  it('reports a parse failure in place and keeps what was typed', () => {
    renderPanel()
    paste('[{"title": "One",}]')
    fireEvent.click(importBtn())

    expect(mocks.importTasks).not.toHaveBeenCalled()
    // The parser's own message, not a generic "invalid JSON" — it says where.
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(box()).toHaveValue('[{"title": "One",}]')
    expect(box()).toHaveAttribute('data-invalid', 'true')
  })

  it('clears the failure as soon as the text is edited', () => {
    renderPanel()
    paste('nonsense')
    fireEvent.click(importBtn())
    expect(screen.getByRole('alert')).toBeInTheDocument()

    paste('[]')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(box()).toHaveAttribute('data-invalid', 'false')
  })

  it('will not import an empty box', () => {
    renderPanel()
    expect(importBtn()).toBeDisabled()
    paste('   ')
    expect(importBtn()).toBeDisabled()
  })

  it('closes without importing on cancel', () => {
    renderPanel()
    paste('[{"title": "One"}]')
    fireEvent.click(screen.getByText('cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(mocks.importTasks).not.toHaveBeenCalled()
  })
})
