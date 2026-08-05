import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import useRealtimeSync from '../useRealtimeSync'

// A WebSocket the test drives by hand.
let socket
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 1
    socket = this
  }
  close() { this.readyState = 3 }
  deliver(payload) { this.onmessage?.({ data: JSON.stringify(payload) }) }
}

const wrap = (qc) => ({ children }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)

describe('useRealtimeSync', () => {
  let qc

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const settle = () => act(() => { vi.advanceTimersByTime(500) })

  it('refreshes a query key it has never heard of', async () => {
    // The point of the hook. It used to name the three keys that existed when it was
    // written, so every page added later — goals, identities, the structure map — went
    // stale in silence when an agent or a workflow rule changed something.
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useRealtimeSync(), { wrapper: wrap(qc) })

    act(() => socket.deliver({ event: 'node.created', data: { node_id: 7 } }))
    settle()

    // No key argument at all: nothing to keep in step with the server.
    expect(invalidate).toHaveBeenCalledWith()
  })

  it('coalesces a burst into a single pass', () => {
    // An agent writing through MCP, or a bulk import, emits a run of events at once.
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useRealtimeSync(), { wrapper: wrap(qc) })

    act(() => {
      for (let i = 0; i < 20; i++) socket.deliver({ event: 'task.updated', data: { task_id: i } })
    })
    settle()

    expect(invalidate.mock.calls.filter(c => c.length === 0)).toHaveLength(1)
  })

  it('handles every event the backend actually broadcasts', () => {
    // Pinned against `grep ws_manager.broadcast` on the backend. A broadcast nobody acts
    // on is the defect this suite exists to catch (comment.* shipped that way).
    const broadcast = [
      'task.created', 'task.updated', 'task.deleted', 'task.reordered',
      'task.bulk_updated', 'task.imported',
      'node.created', 'node.updated', 'node.deleted', 'node.linked', 'node.unlinked',
      'comment.created',
    ]
    for (const event of broadcast) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const invalidate = vi.spyOn(client, 'invalidateQueries')
      const { unmount } = renderHook(() => useRealtimeSync(), { wrapper: wrap(client) })
      act(() => socket.deliver({ event, data: {} }))
      act(() => { vi.advanceTimersByTime(500) })
      expect(invalidate, `${event} was broadcast but nothing acted on it`).toHaveBeenCalledWith()
      unmount()
    }
  })

  it('keeps a notification off the graph refresh path', () => {
    // A notification changes the bell, not the graph, and arrives alongside the mutation
    // that caused it — refreshing the whole screen for it would be pure noise.
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useRealtimeSync(), { wrapper: wrap(qc) })

    act(() => socket.deliver({ event: 'notification.new', data: {} }))
    settle()

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-count'] })
    expect(invalidate.mock.calls.filter(c => c.length === 0)).toHaveLength(0)
  })

  it('ignores an event it does not recognise', () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useRealtimeSync(), { wrapper: wrap(qc) })

    act(() => socket.deliver({ event: 'heartbeat', data: {} }))
    act(() => socket.deliver({ notAnEvent: true }))
    settle()

    expect(invalidate).not.toHaveBeenCalled()
  })
})
