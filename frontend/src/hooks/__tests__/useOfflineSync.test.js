/**
 * Draining the queue (ADR-0062).
 *
 * The half that matters is what happens when a replayed write is refused: a queued action
 * that can never succeed must not sit at the head of the queue blocking every later one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getPending: vi.fn(),
  drop: vi.fn(() => Promise.resolve()),
  count: vi.fn(() => Promise.resolve(0)),
}))

vi.mock('../../api/client', () => ({ default: { request: mocks.request } }))
vi.mock('../../api/offlineQueue', () => ({
  subscribe: vi.fn(() => () => {}),
  getPending: mocks.getPending,
  drop: mocks.drop,
  count: mocks.count,
}))

const { default: useOfflineSync } = await import('../useOfflineSync')

const action = (id, url) => ({ id, method: 'POST', url, data: {} })
const httpError = (status) => Object.assign(new Error(String(status)), { response: { status } })

describe('useOfflineSync replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.count.mockResolvedValue(0)
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('replays in the order the writes were made', async () => {
    // A comment on a task created in the same offline stretch is meaningless first.
    mocks.getPending.mockResolvedValue([action(1, '/api/nodes'), action(2, '/api/nodes/n1/comments')])
    mocks.request.mockResolvedValue({ data: {} })

    const { result } = renderHook(() => useOfflineSync())
    await act(() => result.current.syncPending())

    expect(mocks.request.mock.calls.map(c => c[0].url)).toEqual(['/api/nodes', '/api/nodes/n1/comments'])
    expect(mocks.drop.mock.calls.map(c => c[0])).toEqual([1, 2])
  })

  it('replays without the base URL, and marked so a failure is not re-queued', async () => {
    mocks.getPending.mockResolvedValue([action(1, '/api/nodes')])
    mocks.request.mockResolvedValue({ data: {} })

    const { result } = renderHook(() => useOfflineSync())
    await act(() => result.current.syncPending())

    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ baseURL: '', _replay: true }))
  })

  it('drops an action the server refuses, and carries on', async () => {
    // A deleted target or a stale payload will be refused every time. Keeping it would
    // block the whole queue behind it forever.
    mocks.getPending.mockResolvedValue([action(1, '/api/nodes/gone'), action(2, '/api/nodes')])
    mocks.request.mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({ data: {} })

    const { result } = renderHook(() => useOfflineSync())
    await act(() => result.current.syncPending())

    expect(mocks.drop.mock.calls.map(c => c[0])).toEqual([1, 2])
  })

  it('stops on a server error and keeps the action for next time', async () => {
    mocks.getPending.mockResolvedValue([action(1, '/api/nodes'), action(2, '/api/nodes')])
    mocks.request.mockRejectedValue(httpError(503))

    const { result } = renderHook(() => useOfflineSync())
    await act(() => result.current.syncPending())

    expect(mocks.drop).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('stops when the network is still down, without losing anything', async () => {
    mocks.getPending.mockResolvedValue([action(1, '/api/nodes'), action(2, '/api/nodes')])
    mocks.request.mockRejectedValue(Object.assign(new Error('Network Error'), { config: {} }))

    const { result } = renderHook(() => useOfflineSync())
    await act(() => result.current.syncPending())

    expect(mocks.drop).not.toHaveBeenCalled()
  })

  it('reports what is waiting', async () => {
    mocks.count.mockResolvedValue(3)

    const { result } = renderHook(() => useOfflineSync())

    await waitFor(() => expect(result.current.pendingCount).toBe(3))
  })
})
