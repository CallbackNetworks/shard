import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function useRealtimeSync() {
  const qc = useQueryClient()
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          const { event, data } = JSON.parse(evt.data)
          if (event.startsWith('task.') || event.startsWith('project.')) {
            qc.invalidateQueries({ queryKey: ['projects'] })
            if (data.project_id) {
              qc.invalidateQueries({ queryKey: ['project', data.project_id] })
            }
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
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [qc])
}
