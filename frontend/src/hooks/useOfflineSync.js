import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import { subscribe, getPending, drop, count } from '../api/offlineQueue'

/**
 * Connection state, plus replay of anything written while there was none (ADR-0062).
 *
 * The queue itself lives in `api/offlineQueue.js` and is filled by the axios interceptor —
 * this hook only reports and drains it. It used to own the queue *and* expose the only way
 * to add to it, which nothing ever called, so the count was permanently zero and this whole
 * file was decoration.
 */
export default function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await count())
    } catch { /* IndexedDB unavailable; the indicator simply stays quiet */ }
  }, [])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // The producer is an interceptor, not a component, so the count has to be pushed.
    const unsubscribe = subscribe(refreshCount)
    refreshCount()
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      unsubscribe()
    }
  }, [refreshCount])

  const syncPending = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return
    syncingRef.current = true
    setSyncing(true)
    try {
      for (const action of await getPending()) {
        try {
          // Through the same instance, so the auth header and `/api` base are whatever the
          // rest of the app uses. `_replay` keeps a failure here from being queued again.
          await api.request({
            method: action.method,
            url: action.url,
            data: action.data,
            baseURL: '',
            _replay: true,
          })
          await drop(action.id)
        } catch (err) {
          const status = err.response?.status
          if (status === undefined) {
            // Still no network. Stop; the rest keeps its order for the next attempt.
            break
          }
          if (status >= 400 && status < 500) {
            // The server understood and refused — a deleted target, a stale conflict, a
            // rejected payload. Retrying cannot change that, and keeping it would block
            // every later action behind it forever.
            await drop(action.id)
          } else {
            break
          }
        }
      }
    } finally {
      syncingRef.current = false
      setSyncing(false)
      await refreshCount()
    }
  }, [refreshCount])

  useEffect(() => {
    if (isOnline && pendingCount > 0) syncPending()
  }, [isOnline, pendingCount, syncPending])

  return { isOnline, pendingCount, syncing, syncPending }
}
