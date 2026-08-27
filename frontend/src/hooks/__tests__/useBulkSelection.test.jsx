import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import useBulkSelection from '../useBulkSelection'
import { qk } from '../../api/queryKeys'

/**
 * The two clearing rules used to live in different handlers on the project page
 * — the toggle emptied the selection, and so did the mutation's success — and
 * nothing checked either. Both are asserted here, along with the reason the
 * caller cannot name the task ids itself.
 */

const mocks = vi.hoisted(() => ({ bulkUpdateTasks: vi.fn() }))

vi.mock('../../api/client', () => mocks)

let qc
let invalidateSpy

function setup() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  return renderHook(() => useBulkSelection('p1'), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
}

describe('useBulkSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bulkUpdateTasks.mockResolvedValue({})
  })

  it('starts inactive with nothing selected', () => {
    const { result } = setup()
    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(0)
    expect(result.current.isSelected('t1')).toBe(false)
  })

  it('selects and deselects tasks', () => {
    const { result } = setup()
    act(() => result.current.toggleActive())
    act(() => result.current.toggleTask('t1', true))
    act(() => result.current.toggleTask('t2', true))
    expect(result.current.count).toBe(2)
    expect(result.current.isSelected('t1')).toBe(true)

    act(() => result.current.toggleTask('t1', false))
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('t1')).toBe(false)
  })

  it('drops the selection when bulk mode is turned off', () => {
    const { result } = setup()
    act(() => result.current.toggleActive())
    act(() => result.current.toggleTask('t1', true))
    act(() => result.current.toggleActive())
    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(0)

    // And turning it back on does not resurrect it.
    act(() => result.current.toggleActive())
    expect(result.current.count).toBe(0)
  })

  it('sends the selection with whatever the caller asked to change', async () => {
    const { result } = setup()
    act(() => result.current.toggleActive())
    act(() => result.current.toggleTask('t1', true))
    act(() => result.current.toggleTask('t2', true))
    act(() => result.current.apply({ status: 'done' }))

    await waitFor(() => expect(mocks.bulkUpdateTasks).toHaveBeenCalledWith('p1', {
      task_ids: ['t1', 't2'],
      status: 'done',
    }))
  })

  it('leaves bulk mode and clears the selection once the write lands', async () => {
    const { result } = setup()
    act(() => result.current.toggleActive())
    act(() => result.current.toggleTask('t1', true))
    act(() => result.current.apply({ is_pinned: true }))

    await waitFor(() => {
      expect(result.current.active).toBe(false)
      expect(result.current.count).toBe(0)
    })
    const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
    expect(keys).toContain(JSON.stringify(qk.project('p1')))
    expect(keys).toContain(JSON.stringify(qk.projects()))
  })

  it('clears the selection without leaving bulk mode', () => {
    const { result } = setup()
    act(() => result.current.toggleActive())
    act(() => result.current.toggleTask('t1', true))
    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
    expect(result.current.active).toBe(true)
  })
})
