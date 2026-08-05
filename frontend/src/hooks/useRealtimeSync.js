import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Events that mean the graph changed. Everything the backend broadcasts today is one of
// these prefixes or `notification.new`; an unrecognised event is ignored rather than
// treated as a mutation, so a future non-mutating event cannot cause a refetch storm.
const MUTATION_PREFIXES = ['task.', 'project.', 'node.', 'comment.']

// One pass per burst. An agent writing through MCP, a bulk import, or a workflow rule
// touching a dozen nodes each produce a run of events within milliseconds; without this
// they would each trigger their own round of refetches.
const COALESCE_MS = 250

export default function useRealtimeSync() {
  const qc = useQueryClient()
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const flushTimer = useRef(null)

  useEffect(() => {
    /**
     * Invalidate everything, not a list of keys.
     *
     * This used to name the handful of query keys that existed when it was written
     * (`projects`, `project`, `comments`) — which meant every page added since then held
     * data this hook had never heard of. A goal, an identity, the structure map, the
     * activity feed: all of them were refreshed only by the mutation *the user themselves*
     * performed, so a change arriving from an AI agent or a workflow rule sat invisible
     * until the window lost and regained focus.
     *
     * A blanket invalidation has no list to fall behind. React Query only refetches the
     * queries that are currently mounted — a handful on any one screen — and marks the
     * rest stale for whenever they are next read. The cost of over-invalidating is a
     * redundant GET; the cost of under-invalidating is a screen that quietly lies.
     */
    const flush = () => {
      flushTimer.current = null
      qc.invalidateQueries()
    }

    const scheduleFlush = () => {
      if (flushTimer.current) return
      flushTimer.current = setTimeout(flush, COALESCE_MS)
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          const { event } = JSON.parse(evt.data)
          if (typeof event !== 'string') return
          if (MUTATION_PREFIXES.some(prefix => event.startsWith(prefix))) {
            scheduleFlush()
          } else if (event === 'notification.new') {
            // Narrow on purpose: a notification changes the bell, not the graph, and these
            // arrive alongside the mutation that caused them.
            qc.invalidateQueries({ queryKey: ['notifications'] })
            qc.invalidateQueries({ queryKey: ['notification-count'] })
          }
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        wsRef.current = null
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer.current)
      clearTimeout(flushTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [qc])
}
