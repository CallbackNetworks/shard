import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Clock } from 'lucide-react'
import { DARK } from '../constants/theme'
import { formatMinutes } from '../utils/formatTime'
import { useTranslation } from 'react-i18next'

export default function TimeTracker({ task, onUpdate }) {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef(null)
  const startTimeRef = useRef(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const start = useCallback(() => {
    if (running) return
    setRunning(true)
    setElapsed(0)
    startTimeRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [running])

  const stop = useCallback(() => {
    if (!running) return
    clearInterval(intervalRef.current)
    intervalRef.current = null
    setRunning(false)
    const minutesElapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000))
    const newSpent = (task.time_spent || 0) + minutesElapsed
    onUpdate(task.id, { time_spent: newSpent })
    setElapsed(0)
  }, [running, task.id, task.time_spent, onUpdate])

  const formatElapsed = (secs) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const spent = formatMinutes(task.time_spent) || '0m'
  const est = task.time_estimate ? formatMinutes(task.time_estimate) : null

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: running ? DARK.warning : 'rgba(var(--kt-ink-rgb), 0.35)',
      flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      {running ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); stop() }}
            title={t('timeTracker.stop')}
            style={{
              background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 4, padding: '1px 3px', cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', color: DARK.warning,
            }}
          >
            <Square size={9} fill={DARK.warning} />
          </button>
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {formatElapsed(elapsed)}
          </span>
        </>
      ) : (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); start() }}
            title={t('timeTracker.start')}
            style={{
              background: 'transparent', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)',
              borderRadius: 4, padding: '1px 3px', cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', color: 'rgba(var(--kt-ink-rgb), 0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(52,211,153,0.4)'; e.currentTarget.style.color = DARK.success }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(var(--kt-ink-rgb), 0.1)'; e.currentTarget.style.color = 'rgba(var(--kt-ink-rgb), 0.3)' }}
          >
            <Play size={9} fill="currentColor" />
          </button>
          <Clock size={10} />
          <span>{spent}</span>
          {est && <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.15)' }}>/ {est}</span>}
        </>
      )}
    </span>
  )
}
